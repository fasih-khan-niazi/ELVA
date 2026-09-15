import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Props = { content: string; className?: string };

export function MarkdownDoc({ content, className = '' }: Props) {
    return (
        <article className={`markdown-doc max-w-[52rem] ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    h1: ({ children }) => (
                        <h1 className="text-2xl font-bold text-ocean-navy tracking-tight mt-10 mb-4 first:mt-0">{children}</h1>
                    ),
                    h2: ({ children }) => (
                        <h2 className="text-lg font-semibold text-ocean-navy mt-8 mb-3 border-b border-ocean-sky/40 pb-1">{children}</h2>
                    ),
                    h3: ({ children }) => <h3 className="text-base font-semibold text-ocean-navy mt-5 mb-2">{children}</h3>,
                    p: ({ children }) => <p className="text-sm leading-relaxed text-ocean-deep/92 mb-3">{children}</p>,
                    ul: ({ children }) => (
                        <ul className="list-disc list-outside pl-5 mb-4 space-y-1.5 text-sm text-ocean-deep/92">{children}</ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="list-decimal list-outside pl-5 mb-4 space-y-1.5 text-sm text-ocean-deep/92">{children}</ol>
                    ),
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold text-ocean-deep">{children}</strong>,
                    a: ({ href, children }) => (
                        <a
                            href={href}
                            className="text-ocean-rich font-semibold underline-offset-2 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {children}
                        </a>
                    ),
                    hr: () => <hr className="my-8 border-ocean-sky/50" />,
                    code: ({ children }) => (
                        <code className="rounded bg-ocean-powder/90 px-1.5 py-0.5 text-[0.8125rem] font-mono text-ocean-navy border border-ocean-sky/50">
                            {children}
                        </code>
                    ),
                    pre: ({ children }) => (
                        <pre className="my-4 overflow-x-auto rounded-xl border border-ocean-sky/50 bg-white/95 p-4 text-xs text-ocean-deep shadow-sm">
                            {children}
                        </pre>
                    ),
                    table: ({ children }) => (
                        <div className="overflow-x-auto my-4 rounded-lg border border-ocean-sky/50">
                            <table className="min-w-full text-sm text-ocean-deep">{children}</table>
                        </div>
                    ),
                    th: ({ children }) => (
                        <th className="bg-ocean-mist/50 px-3 py-2 text-left font-semibold text-ocean-navy border-b border-ocean-sky/50">{children}</th>
                    ),
                    td: ({ children }) => <td className="px-3 py-2 border-t border-ocean-sky/30 align-top">{children}</td>,
                }}
            >
                {content}
            </ReactMarkdown>
        </article>
    );
}
