import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * 現在のログインユーザーのアクセストークンを安全に取得する共通関数
 */
export async function getAccessToken(): Promise<string | null> {
try {
    const session = await fetchAuthSession();
    const token = session.tokens?.accessToken?.toString();
    
    if (!token) {
      console.warn('アクセストークンが見つかりません。未ログインの可能性があります。');
      return null;
    }
    return token;
    
  } catch (error) {
    console.error('認証セッションの取得に失敗しました:', error);
    return null;
  }
}
