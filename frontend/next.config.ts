// 静的HTML出力設定
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 静的HTML・CSS・JSとして out フォルダに出力する設定✨ */
  output: "export",
  
  /* S3等で静的出力する際、Next.jsの画像最適化サーバー依存によるエラーを防ぐ神設定✨ */
  images: {
    unoptimized: true,
  },
  turbopack: {
     rules: {
       "*.css": {
         loaders: ["@tailwindcss/turbopack"],
         as: "*.css",
       },
     },
   },
};

export default nextConfig;
