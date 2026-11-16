'use client'

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "@/components/CodeBlock";

interface MarkdownRendererProps {
    content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                // 1. コードブロック（CodeBlockコンポーネントを利用）
                code({ node, inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || "");
                    return !inline && match ? (
                        <CodeBlock
                            language={match[1]}
                            value={String(children).replace(/\n$/, "")}
                        />
                    ) : (
                        <code
                            className={className}
                            {...props}
                            style={{
                                background: "rgba(255,255,255,0.1)",
                                padding: "0.2rem 0.4rem",
                                borderRadius: "4px",
                            }}
                        >
                            {children}
                        </code>
                    );
                },
                // テーブル（表）を綺麗に見せるためのカスタムスタイル追加
                table({ children }) {
                    return (
                        <div className="overflow-x-auto my-4">
                            <table className="min-w-full border-collapse border border-white/20 text-left text-sm">
                                {children}
                            </table>
                        </div>
                    );
                },
                th({ children }) {
                    return (
                        <th className="border border-white/20 bg-white/10 px-4 py-2 font-semibold text-white">
                            {children}
                        </th>
                    );
                },
                td({ children }) {
                    return (
                        <td className="border border-white/20 px-4 py-2 text-white/90">
                            {children}
                        </td>
                    );
                },
                // 見出し（h1, h2, h3）のスタイル追加
                h1({ children }) {
                    return <h1 className="text-xl font-bold text-white mt-4 mb-2 border-b border-white/20 pb-1">{children}</h1>;
                },
                h2({ children }) {
                    return <h2 className="text-lg font-bold text-white mt-3 mb-2">{children}</h2>;
                },
                h3({ children }) {
                    return <h3 className="text-md font-semibold text-white/90 mt-2 mb-1">{children}</h3>;
                },
                h4({ children }) {
                    return <h4 className="text-sm font-semibold text-white/90 mt-2 mb-1">{children}</h4>;
                },
                h5({ children }) {
                    return <h5 className="text-xs font-semibold text-white/80 mt-1 mb-1">{children}</h5>;
                },
                h6({ children }) {
                    return <h6 className="text-xs text-white/70 mt-1 mb-1">{children}</h6>;
                },
                // リスト（箇条書き、番号付きリスト）のスタイル追加
                ul({ children }) {
                    return <ul className="list-disc list-inside my-2 space-y-1 text-white/90">{children}</ul>;
                },
                ol({ children }) {
                    return <ol className="list-decimal list-inside my-2 space-y-1 text-white/90">{children}</ol>;
                },
                li({ children }) {
                    return <li className="ml-2">{children}</li>;
                },
                // 引用（blockquote）のカスタムスタイル追加
                blockquote({ children }) {
                    return (
                        <blockquote className="border-l-4 border-indigo-400 bg-white/5 px-4 py-2 my-3 rounded-r-lg italic text-white/80">
                            {children}
                        </blockquote>
                    );
                },
                // リンクのスタイル追加
                a({ href, children }) {
                    return (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline hover:text-indigo-200 transition">
                            {children}
                        </a>
                    );
                },
            }}
        >
            {content}
        </ReactMarkdown>
    );
}