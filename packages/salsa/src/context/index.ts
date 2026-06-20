/**
 * @file Context read/write operations (full and single context) for salsa.
 *
 * @module
 */

import {
  Context,
  chrisContext,
  FullContext,
  SingleContext,
  errorStack,
  Result,
  Ok,
  Err,
} from "@fnndsc/cumin";

/**
 * Options describing a context mutation (URL, user, feed, folder, etc.).
 */
export interface ContextOptions {
  ChRISurl?: string;
  ChRISuser?: string;
  ChRISfolder?: string;
  ChRISfeed?: string;
  ChRISplugin?: string;
  pacsserver?: string;
  full?: boolean;
  all?: boolean;
}

/**
 * Returns the full current context.
 *
 * @returns The full context object.
 */
export function context_getFull(): FullContext {
  return chrisContext.fullContext_get();
}

/**
 * Returns the single (resolved) current context.
 *
 * @returns Promise resolving to the single context.
 */
export async function context_getSingle(): Promise<SingleContext> {
  await chrisContext.currentContext_update();
  return chrisContext.singleContext;
}

/**
 * Applies one or more context mutations.
 *
 * @param options - The context fields to set.
 * @returns Result wrapping the list of applied keys.
 */
export async function context_set(options: ContextOptions): Promise<Result<string[]>> {
  const results: string[] = [];

  const setters: { key: keyof ContextOptions; context: Context }[] = [
    { key: 'ChRISuser',   context: Context.ChRISuser   },
    { key: 'ChRISurl',    context: Context.ChRISURL     },
    { key: 'ChRISfolder', context: Context.ChRISfolder  },
    { key: 'ChRISfeed',   context: Context.ChRISfeed    },
    { key: 'ChRISplugin', context: Context.ChRISplugin  },
    { key: 'pacsserver',  context: Context.PACSserver   },
  ];

  for (const { key, context } of setters) {
    const value: string | boolean | undefined = options[key];
    if (value !== undefined && typeof value === 'string') {
      const success: boolean = await chrisContext.current_set(context, value);
      if (!success) {
        errorStack.stack_push('error', errorStack.allOfType_get('error').join('\n'));
        return Err();
      }
      results.push(`${context} set to ${value}`);
    }
  }

  return Ok(results);
}
