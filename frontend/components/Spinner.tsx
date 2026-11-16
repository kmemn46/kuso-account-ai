'use client'

export default function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
    // サイズごとのクラス切り替え
    const sizeClasses = {
        sm: "w-4 h-4 border-2",
        md: "w-6 h-6 border-2",
        lg: "w-10 h-10 border-4",
    };

    return (
        <div
            className={`inline-block ${sizeClasses[size]} animate-spin rounded-full border-solid border-indigo-500 border-t-transparent`}
            role="status"
            aria-label="loading"
        />
    );
}
