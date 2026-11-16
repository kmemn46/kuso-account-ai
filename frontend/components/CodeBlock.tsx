'use client'

import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeBlockProps {
    language: string;
    value: string;
}

export default function CodeBlock({ language, value }: CodeBlockProps) {
    const [isCopied, setIsCopied] = useState(false);

    // コピーボタンが押されたときの処理
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setIsCopied(true);
            // 2秒後に「Copied!」の表示を元の「Copy」に戻す
            setTimeout(() => {
                setIsCopied(false);
            }, 2000);
        } catch (err) {
            console.error("コピーに失敗しました:", err);
        }
    };

    return (
        <div className="relative group rounded-xl overflow-hidden my-4 border border-white/10 bg-[#1e1e1e]">
            {/* ヘッダー部分（言語名とコピーボタンを配置） */}
            <div className="flex items-center justify-between px-4 py-1.5 bg-[#2d2d2d] text-xs text-white/70 border-b border-white/10">
                <span>{language || "code"}</span>
                <button
                    onClick={handleCopy}
                    className="bg-white/10 hover:bg-white/20 text-white px-2.5 py-1 rounded transition text-xs font-medium flex items-center gap-1"
                >
                    {isCopied ? "✓ Copied!" : "📋 Copy"}
                </button>
            </div>

            {/* シンタックスハイライト付きのコード本体 */}
            <SyntaxHighlighter
                style={vscDarkPlus}
                language={language}
                PreTag="div"
                customStyle={{ margin: 0, padding: "1rem", background: "transparent" }}
            >
                {value}
            </SyntaxHighlighter>
        </div>
    );
}