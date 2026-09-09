/**
 * @file Stands in for xmlbuilder2, which vtk.js's XML reader and writer
 * import and the image pane never uses. The real package is CommonJS and its
 * class hierarchy breaks under Vite's interop at module init, taking the
 * whole surface down before the console can say why.
 *
 * @module
 */
export const create = (): never => {
  throw new Error('xmlbuilder2 is stubbed in the argus prototype');
};
export const fragment = create;
export const convert = create;
export default { create, fragment, convert };
