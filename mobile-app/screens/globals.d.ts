// This tells TypeScript that these modules exist, even if they don't have built-in types.
declare module 'text-encoding-polyfill';
declare module 'text-encoding';

// This tells TypeScript about the 'global' object, which exists in React Native's environment.
declare var global: any;
