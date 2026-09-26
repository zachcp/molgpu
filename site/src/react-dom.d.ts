declare module "react-dom/client" {
  export function createRoot(container: Element | DocumentFragment): {
    render(node: React.ReactNode): void;
  };
}
