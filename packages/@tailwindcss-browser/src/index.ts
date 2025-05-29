import * as tailwindcss from 'tailwindcss'
import * as assets from './assets'
import { Instrumentation } from './instrumentation'

/**
 * The current Tailwind CSS compiler.
 */
let compiler: Awaited<ReturnType<typeof tailwindcss.compile>>

/**
 * Registry of all processed classes
 */
const processedClasses = new Set<string>()

/**
 * The stylesheet that we use to inject the compiled CSS into the page.
 */
let sheet: HTMLStyleElement

/**
 * The queue of build tasks that need to be run
 */
let buildQueue = Promise.resolve()

/**
 * Used for instrumenting the build process
 */
const I = new Instrumentation()

/**
 * Create the Tailwind CSS compiler with custom or default styles
 */
export async function initializeCompiler(customCss?: string) {
  I.start(`Initialize compiler`)

  // Default CSS with Tailwind imports, or use custom CSS if provided
  const css = customCss ?? `@import "tailwindcss";`

  I.start('Compile CSS')
  try {
    compiler = await tailwindcss.compile(css, {
      base: '/',
      loadStylesheet,
      loadModule,
    })

    // Create and append stylesheet if it doesn't exist
    if (!sheet) {
      sheet = document.createElement('style')
      document.head.append(sheet)
    }
  } finally {
    I.end('Compile CSS')
    I.end(`Initialize compiler`)
  }
}

async function loadStylesheet(id: string, base: string) {
  function load() {
    if (id === 'tailwindcss') {
      return {
        path: 'virtual:tailwindcss/index.css',
        base,
        content: assets.css.index,
      }
    } else if (
      id === 'tailwindcss/preflight' ||
      id === 'tailwindcss/preflight.css' ||
      id === './preflight.css'
    ) {
      return {
        path: 'virtual:tailwindcss/preflight.css',
        base,
        content: assets.css.preflight,
      }
    } else if (
      id === 'tailwindcss/theme' ||
      id === 'tailwindcss/theme.css' ||
      id === './theme.css'
    ) {
      return {
        path: 'virtual:tailwindcss/theme.css',
        base,
        content: assets.css.theme,
      }
    } else if (
      id === 'tailwindcss/utilities' ||
      id === 'tailwindcss/utilities.css' ||
      id === './utilities.css'
    ) {
      return {
        path: 'virtual:tailwindcss/utilities.css',
        base,
        content: assets.css.utilities,
      }
    }

    throw new Error(`The browser build does not support @import for "${id}"`)
  }

  try {
    let stylesheet = load()
    I.hit(`Loaded stylesheet`, { id, base, size: stylesheet.content.length })
    return stylesheet
  } catch (err) {
    I.hit(`Failed to load stylesheet`, {
      id,
      base,
      error: (err as Error).message ?? err,
    })
    throw err
  }
}

async function loadModule(): Promise<never> {
  throw new Error(`The browser build does not support plugins or config files.`)
}

/**
 * Process and compile CSS for the given classes
 */
async function processClasses(classNames: string[]) {
  if (!compiler) {
    await initializeCompiler()
  }

  // Filter out classes that have already been processed
  const newClasses = classNames.filter((cls) => !processedClasses.has(cls))

  if (newClasses.length === 0) return

  I.start(`Process new classes`)

  // Add new classes to the registry
  for (const cls of newClasses) {
    processedClasses.add(cls)
  }

  // Build CSS for ALL processed classes to avoid duplication
  const allProcessedClasses = Array.from(processedClasses)
  const compiledCss = compiler.build(allProcessedClasses)

  // Replace the stylesheet content rather than appending
  sheet.textContent = compiledCss

  I.end(`Process new classes`, { count: newClasses.length, total: allProcessedClasses.length })
}

/**
 * Queue processing of classes
 */
function queueClassProcessing(classNames: string[]) {
  buildQueue = buildQueue.then(() => processClasses(classNames)).catch((err) => I.error(err))
}

/**
 * Parse a string of classes into an array of individual class names
 */
function parseClassString(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean)
}

/**
 * Combines multiple class values into a single string.
 * Accepts strings, objects where keys are class names and values are booleans,
 * and falsy values which are ignored.
 *
 * @example
 * tw(
 *   "p-5 text-white bg-black", // Always included
 *   isActive && "underline",   // Conditionally included based on truthiness
 *   {
 *     "font-bold": isBold,     // Included if isBold is true
 *     "italic": !isBold        // Included if isBold is false
 *   }
 * )
 */
export function tw(
  ...inputs: (string | boolean | null | undefined | { [key: string]: boolean })[]
): string {
  const resultClasses: string[] = []
  const allClassesToProcess: string[] = []

  for (const input of inputs) {
    if (!input) continue // Skip falsy values (false, null, undefined, etc.)

    if (typeof input === 'string') {
      const parsedClasses = parseClassString(input)
      resultClasses.push(...parsedClasses)
      allClassesToProcess.push(...parsedClasses)
    } else if (typeof input === 'object') {
      // Handle objects where keys are class names and values are booleans
      for (const [className, condition] of Object.entries(input)) {
        // Process the class names for Tailwind, regardless of condition
        const parsedClasses = parseClassString(className)
        allClassesToProcess.push(...parsedClasses)

        // Only include in the result if the condition is true
        if (condition) {
          resultClasses.push(...parsedClasses)
        }
      }
    }
  }

  // Make sure we're processing ALL potential classes
  queueClassProcessing(allClassesToProcess)

  // Return the combined class string of only the active classes
  return resultClasses.join(' ')
}
