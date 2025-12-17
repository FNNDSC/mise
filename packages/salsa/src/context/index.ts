import {
  Context,
  chrisContext,
  FullContext,
  SingleContext,
  errorStack
} from "@fnndsc/cumin";

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

export function context_getFull(): FullContext {
  return chrisContext.fullContext_get();
}

export function context_getSingle(): SingleContext {
  chrisContext.currentContext_update();
  return chrisContext.singleContext;
}

export async function context_set(options: ContextOptions): Promise<string[]> {
  const results: string[] = [];

  const setters: { key: keyof ContextOptions, context: Context }[] = [
    { key: 'ChRISuser', context: Context.ChRISuser },
    { key: 'ChRISurl', context: Context.ChRISURL },
    { key: 'ChRISfolder', context: Context.ChRISfolder },
    { key: 'ChRISfeed', context: Context.ChRISfeed },
    { key: 'ChRISplugin', context: Context.ChRISplugin },
    { key: 'pacsserver', context: Context.PACSserver },
  ];

  for (const { key, context } of setters) {
    const value = options[key];
    if (value !== undefined && typeof value === 'string') {
      const success = await chrisContext.current_set(context, value);
      if (!success) {
        throw new Error(errorStack.allOfType_get("error").join('\n'));
      }
      results.push(`${context} set to ${value}`);
    }
  }

  return results;
}
