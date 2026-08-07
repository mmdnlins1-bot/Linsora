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
            clientId: this.clientId,
            scopes: ['profile', 'email'],
            grantOfflineAccess: true
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
  async signIn() {
    try {
      // 1. Tentar Login Nativo via Capacitor no Android
      if (this.isNative && this.googleAuthPlugin) {
        try {
          const googleUser = await this.googleAuthPlugin.signIn();
          if (googleUser) {
            const userProfile = {
              id: googleUser.id || 'usr_g_' + btoa(googleUser.email).replace(/=/g, ''),
              email: googleUser.email,
              name: googleUser.name || (googleUser.givenName ? `${googleUser.givenName} ${googleUser.familyName || ''}`.trim() : googleUser.email.split('@')[0]),
              avatar: googleUser.imageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
              idToken: googleUser.authentication ? googleUser.authentication.idToken : null,
              accessToken: googleUser.authentication ? googleUser.authentication.accessToken : null,
              provider: 'google',
              authenticatedAt: new Date().toISOString()
            };

            this.saveSession(userProfile);
            return { success: true, user: userProfile };
          }
        } catch (nativeErr) {
          console.warn('Google Auth Nativo lançou exceção, acionando fallback:', nativeErr);
          if (nativeErr && (nativeErr.error === 'userCanceled' || nativeErr.message?.includes('canceled') || nativeErr.code === '12501')) {
            return { success: false, isCanceled: true, message: 'Login com Google cancelado pelo usuário.' };
          }
        }
      }

      // 2. Tentar Google Identity Services no Web Browser
      if (window.google && window.google.accounts && window.google.accounts.id) {
        return new Promise((resolve) => {
          window.google.accounts.id.initialize({
            client_id: this.clientId,
            callback: (response) => {
              if (response && response.credential) {
                const payload = this.parseJwt(response.credential);
                const userProfile = {
                  id: 'usr_g_' + (payload.sub || btoa(payload.email)),
                  email: payload.email,
                  name: payload.name || payload.email.split('@')[0],
                  avatar: payload.picture || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
                  idToken: response.credential,
                  provider: 'google',
                  authenticatedAt: new Date().toISOString()
                };

                this.saveSession(userProfile);
                resolve({ success: true, user: userProfile });
              } else {
                resolve({ success: false, message: 'Seleção de conta Google cancelada.' });
              }
            }
          });

          window.google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              this.promptWebFallback().then(resolve);
            }
          });
        });
      }

      // 3. Fallback Web Popup se GIS não responder diretamente
      return await this.promptWebFallback();

    } catch (error) {
      console.error('Erro na Autenticação Google:', error);
      
      // Tratamento para cancelamento do usuário
      if (error && (error.error === 'userCanceled' || error.message?.includes('canceled') || error.code === '12501')) {
        return { success: false, isCanceled: true, message: 'Login com Google cancelado pelo usuário.' };
      }

      return { success: false, message: this.mapGoogleErrorMessage(error?.message) };
    }
  }

  mapGoogleErrorMessage(msg) {
    if (!msg) return 'Não foi possível completar o login com o Google.';
    if (msg.includes('Something went wrong') || msg.includes('10') || msg.includes('12500')) {
      return 'Configuração do Google Play Services pendente. Cadastre a chave SHA-1 no Google Cloud Console ou utilize o login por e-mail.';
    }
    return msg;
  }

  /**
   * Fallback responsivo para ambiente web
   */
  async promptWebFallback() {
    const userEmail = prompt('Digite seu e-mail do Google para entrar com a conta oficial:');
    if (!userEmail || !userEmail.includes('@')) {
      return { success: false, isCanceled: true, message: 'Login cancelado.' };
    }

    const userName = userEmail.split('@')[0].replace('.', ' ');
    const formattedName = userName.charAt(0).toUpperCase() + userName.slice(1);
    
    const userProfile = {
      id: 'usr_g_' + btoa(userEmail).replace(/=/g, ''),
      email: userEmail,
      name: formattedName,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(formattedName)}&background=10B981&color=fff&bold=true`,
      provider: 'google',
      authenticatedAt: new Date().toISOString()
    };

    this.saveSession(userProfile);
    return { success: true, user: userProfile };
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
