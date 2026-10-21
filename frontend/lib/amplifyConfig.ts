'use client';

import { Amplify } from "aws-amplify";

// Next.jsの環境変数からCognitoの情報を読み込んでAmplifyを設定する
Amplify.configure({
    Auth: {
        Cognito: {
            userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID || '',
            userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || '',
        }
    }
});

// 初期化された設定内容をコンソールログに出力
// console.log('Amplify Current Config:', Amplify.getConfig());

export function ConfigureAmplify() {
    return null;
}