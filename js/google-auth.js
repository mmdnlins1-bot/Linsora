/**
 * ==========================================================================
 * LINSORA FINANCES — MÓDULO DE AUTENTICAÇÃO OFICIAL DO GOOGLE (ANDROID & WEB)
 * Suporte a Google Play Services Credential Manager, Capacitor GoogleAuth e GIS
 * ==========================================================================
 */

class LinsoraGoogleAuthManager {
  constructor() {
    this.storageKey = 'linsora_google_session';
    this.clientId = '465194772971-gmggsoaduqo12i9l96618atgf639dr9h.apps.googleusercontent.com';
    this.isNative = false;
    this.googleAuthPlugin = null;

    this.init();
  }

  init() {
    try {
      if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        this.isNative = true;
        if (window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth) {
          this.googleAuthPlugin = window.Capacitor.Plugins.GoogleAuth;
          this.googleAuthPlugin.initialize({
            scopes: ['profile', 'email']
          }).catch(err => console.log('Capacitor GoogleAuth Init Warning:', err));
        }
      }
    } catch (e) {
      console.warn('Erro ao inicializar GoogleAuth nativo:', e);
    }
  }

  /**
   * Realiza login nativo com o Google (Abre a janela nativa de Seleção de Contas no Android)
   */
  parseGoogleResponse(googleUser) {
    console.log('[DEBUG_1_GOOGLE_AUTH_RAW_SIGNIN_RESPONSE]', JSON.stringify(googleUser, null, 2));

    if (!googleUser) return null;
    if (googleUser instanceof Error || googleUser.name === 'Error' || googleUser.name === 'TypeError') {
      console.warn('[DEBUG_1_REJECTED_ERROR_OBJECT]', googleUser);
      return null;
    }

    let jwtPayload = {};
    const idToken = googleUser.authentication?.idToken || googleUser.idToken || (typeof googleUser === 'string' ? googleUser : null);
    if (idToken) {
      jwtPayload = this.parseJwt(idToken);
    }

    // Leitura resiliente do e-mail
    const email = googleUser.email || googleUser.user?.email || googleUser.account?.email || jwtPayload.email || null;

    // Leitura resiliente do ID / sub
    const sub = googleUser.id || googleUser.sub || googleUser.user?.id || googleUser.account?.id || jwtPayload.sub || (email ? btoa(email).replace(/=/g, '') : null);

    // Leitura resiliente do nome (ignorando nomes reservados de objetos Error)
    let rawName = googleUser.name || googleUser.displayName || googleUser.user?.name || googleUser.account?.name || jwtPayload.name;
    const reservedErrorNames = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'ApiException'];
    if (reservedErrorNames.includes(rawName)) {
      rawName = null;
    }

    if (!rawName) {
      const given = googleUser.givenName || googleUser.user?.givenName || jwtPayload.given_name || '';
      const family = googleUser.familyName || googleUser.user?.familyName || jwtPayload.family_name || '';
      rawName = `${given} ${family}`.trim() || (email ? email.split('@')[0] : null);
    }

    if (!rawName || !email || !sub) {
      console.warn('[DEBUG_PARSER_MISSING_REQUIRED_FIELDS]', { rawName, email, sub });
      return null;
    }

    const finalName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const finalEmail = email;
    const finalSub = sub;

    // Leitura minuciosa da foto oficial do Google em todos os possíveis campos de resposta
    const googlePhotoUrl = googleUser.imageUrl || 
                          googleUser.photoUrl || 
                          googleUser.picture || 
                          googleUser.user?.imageUrl || 
                          googleUser.user?.picture || 
                          googleUser.user?.photoUrl || 
                          googleUser.account?.imageUrl || 
                          googleUser.account?.photoUrl || 
                          jwtPayload.picture || 
                          jwtPayload.avatar_url || 
                          null;

    console.log('[DEBUG_PHOTO_URL_FOUND]', googlePhotoUrl);

    const avatar = googlePhotoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(finalName)}&background=10B981&color=fff&bold=true`;

    const profile = {
      id: finalSub.startsWith('usr_g_') ? finalSub : 'usr_g_' + finalSub,
      sub: finalSub,
      email: finalEmail,
      name: finalName,
      avatar: avatar,
      idToken: idToken,
      accessToken: googleUser.authentication?.accessToken || googleUser.accessToken || null,
      provider: 'google',
      authenticatedAt: new Date().toISOString()
    };

    console.log('[DEBUG_2_GOOGLE_AUTH_EXTRACTED_PROFILE]', JSON.stringify(profile, null, 2));
    return profile;
  }

  async signIn() {
    try {
      // 1. Tentar Login Nativo via Capacitor no Android
      if (this.isNative && this.googleAuthPlugin) {
        try {
          const googleUser = await this.googleAuthPlugin.signIn();
          console.log('[DEBUG_1_RAW_GOOGLE_USER_RESPONSE]', JSON.stringify(googleUser, null, 2));
          const profile = this.parseGoogleResponse(googleUser);
          if (profile) {
            this.saveSession(profile);
            console.log('[DEBUG_3_GOOGLE_AUTH_SAVED_SESSION]', JSON.stringify(profile, null, 2));
            return { success: true, user: profile };
          }
        } catch (nativeErr) {
          console.warn('[DEBUG_1_NATIVE_ERROR_OBJECT]:', nativeErr);
          const errStr = String(nativeErr?.message || nativeErr?.error || nativeErr || '');
          
          if (nativeErr && (nativeErr.error === 'userCanceled' || errStr.includes('canceled') || nativeErr.code === '12501' || errStr.includes('12501'))) {
            return { success: false, isCanceled: true, message: 'Login com Google cancelado pelo usuário.' };
          }

          return await this.createSeamlessGoogleSession();
        }
      }

      // 2. Tentar Google Identity Services no Web Browser
      if (window.google && window.google.accounts && window.google.accounts.id) {
        return new Promise((resolve) => {
          window.google.accounts.id.initialize({
            client_id: this.clientId,
            callback: (response) => {
              if (response && response.credential) {
                console.log('[DEBUG_1_RAW_GIS_CREDENTIAL]', response.credential);
                const profile = this.parseGoogleResponse(response.credential);
                if (profile) {
                  this.saveSession(profile);
                  console.log('[DEBUG_3_GOOGLE_AUTH_SAVED_SESSION]', JSON.stringify(profile, null, 2));
                  resolve({ success: true, user: profile });
                  return;
                }
              }
              resolve({ success: false, message: 'Seleção de conta Google cancelada.' });
            }
          });

          window.google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              resolve(this.createSeamlessGoogleSession());
            }
          });
        });
      }

      return await this.createSeamlessGoogleSession();

    } catch (error) {
      console.error('[DEBUG GoogleAuth.signIn EXCEPTION]:', error);
      
      if (error && (error.error === 'userCanceled' || error.message?.includes('canceled') || error.code === '12501')) {
        return { success: false, isCanceled: true, message: 'Login com Google cancelado pelo usuário.' };
      }

      return await this.createSeamlessGoogleSession();
    }
  }

  /**
   * Sessão de fallback sem valores fixos mascarados
   */
  async createSeamlessGoogleSession(partialData = null) {
    const profile = this.parseGoogleResponse(partialData);
    if (profile) {
      this.saveSession(profile);
      console.log('[DEBUG_3_GOOGLE_AUTH_SAVED_SESSION]', JSON.stringify(profile, null, 2));
      return { success: true, user: profile };
    }

    const saved = this.getActiveSession();
    if (saved && saved.email && saved.name) {
      console.log('[DEBUG_3_GOOGLE_AUTH_SAVED_SESSION]', JSON.stringify(saved, null, 2));
      return { success: true, user: saved };
    }

    return { success: false, message: 'Não foi possível extrair dados da conta Google.' };
  }

  /**
   * Decodifica token JWT retornado pelo Google Identity Services
   */
  parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) {
      return {};
    }
  }

  /**
   * Salva a sessão ativa do usuário Google
   */
  saveSession(userProfile) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(userProfile));
    } catch (e) {
      console.warn('Falha ao salvar sessão Google:', e);
    }
  }

  /**
   * Recupera a sessão ativa do Google se existir
   */
  getActiveSession() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /**
   * Encerra a sessão com o Google (Sign Out completo)
   */
  async signOut() {
    try {
      if (this.isNative && this.googleAuthPlugin) {
        await this.googleAuthPlugin.signOut().catch(() => {});
      }
    } catch (e) {
      console.warn('Erro ao deslogar do Google nativo:', e);
    } finally {
      localStorage.removeItem(this.storageKey);
    }
  }
}

// Instância Global
window.LinsoraGoogleAuth = new LinsoraGoogleAuthManager();
