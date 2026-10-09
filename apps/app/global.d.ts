/**
 * NativeWind compiles global.css at build time. TypeScript needs to be told
 * that importing it is legitimate.
 */
declare module '*.css';
