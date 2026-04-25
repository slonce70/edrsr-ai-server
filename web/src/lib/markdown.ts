type MarkdownRuntime = {
  render: (markdown?: string | null) => string;
};

let runtimePromise: Promise<MarkdownRuntime> | null = null;

async function loadRuntime(): Promise<MarkdownRuntime> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([import('marked'), import('dompurify')]).then(
      ([{ marked }, { default: DOMPurify }]) => {
        marked.setOptions({
          gfm: true,
          breaks: true,
        });

        return {
          render(markdown?: string | null) {
            const content = markdown || '';
            const html = marked.parse(content) as string;
            return DOMPurify.sanitize(String(html));
          },
        };
      }
    );
  }

  return runtimePromise;
}

export async function renderMarkdown(markdown?: string | null) {
  const runtime = await loadRuntime();
  return runtime.render(markdown);
}
