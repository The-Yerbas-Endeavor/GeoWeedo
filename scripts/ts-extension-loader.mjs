export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExtension = /\.[A-Za-z0-9]+(?:[?#].*)?$/.test(specifier);
    if (!isRelative || hasExtension) throw error;

    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      throw error;
    }
  }
}
