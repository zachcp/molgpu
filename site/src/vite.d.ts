declare module "*?url" {
  const url: string;
  export default url;
}
interface ImportMeta {
  glob<T>(
    pattern: string,
    options: { query: string; import: "default"; eager: true },
  ): Record<string, T>;
}
