/**
 * ==========================================================================
 * LINSORA FINANCES — MÓDULO DE AUTENTICAÇÃO OFICIAL DO GOOGLE (ANDROID & WEB)
 * Suporte a Google Play Services Credential Manager, Capacitor GoogleAuth e GIS
 * ==========================================================================
 */

class LinsoraGoogleAuthManager {
  constructor() {
    this.storageKey = 'linsora_google_session';
    this.clientId = '562170488279-kh7sakqarsajjg4bolkqri9k08ft5erk.apps.googleusercontent.com';
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
    const finalEmail = String(email).toLowerCase().trim();
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
    // ═══════════════════════════════════════════════════════
    // 🔍 DEBUG MODE — REMOVER APÓS DIAGNÓSTICO
    // ═══════════════════════════════════════════════════════
    const dbg = (label, data) => {
      const msg = `[LINSORA DEBUG]\n${label}\n\n${typeof data === 'object' ? JSON.stringify(data, Object.getOwnPropertyNames(data), 2) : String(data)}`;
      console.warn(msg);
      alert(msg);
    };

    dbg('ETAPA 0 — signIn() INICIADO', {
      isNative: this.isNative,
      hasPlugin: !!this.googleAuthPlugin,
      capacitorExists: !!window.Capacitor,
      isNativePlatform: window.Capacitor?.isNativePlatform?.() ?? false,
      pluginKeys: window.Capacitor?.Plugins ? Object.keys(window.Capacitor.Plugins) : 'N/A'
    });

    try {
      // ── ETAPA 1: Plugin Nativo Capacitor ─────────────────
      if (this.isNative && this.googleAuthPlugin) {
        dbg('ETAPA 1 — Chamando googleAuthPlugin.signIn()...', { plugin: String(this.googleAuthPlugin) });
        try {
          const googleUser = await this.googleAuthPlugin.signIn();
          dbg('ETAPA 1 — SUCESSO googleAuthPlugin.signIn()', googleUser);
          console.log('[DEBUG_1_RAW_GOOGLE_USER_RESPONSE]', JSON.stringify(googleUser, null, 2));
          const profile = this.parseGoogleResponse(googleUser);
          dbg('ETAPA 1 — parseGoogleResponse resultado', profile);
          if (profile) {
            this.saveSession(profile);
            console.log('[DEBUG_3_GOOGLE_AUTH_SAVED_SESSION]', JSON.stringify(profile, null, 2));
            return { success: true, user: profile };
          }
          dbg('ETAPA 1 — FALHA: parseGoogleResponse retornou null', { rawGoogleUser: googleUser });
        } catch (nativeErr) {
          // ⚠️ CAPTURA DO ERRO NATIVO REAL
          dbg('ETAPA 1 — EXCEÇÃO NATIVA CAPTURADA', {
            message:  nativeErr?.message  || 'sem message',
            code:     nativeErr?.code     || 'sem code',
            error:    nativeErr?.error    || 'sem error',
            name:     nativeErr?.name     || 'sem name',
            stack:    nativeErr?.stack    || 'sem stack',
            toString: String(nativeErr),
            full:     nativeErr
          });
          console.warn('[DEBUG_1_NATIVE_ERROR_OBJECT]:', nativeErr);
          const errStr = String(nativeErr?.message || nativeErr?.error || nativeErr || '');

          if (nativeErr && (nativeErr.error === 'userCanceled' || errStr.includes('canceled') || nativeErr.code === '12501' || errStr.includes('12501'))) {
            return { success: false, isCanceled: true, message: 'Login com Google cancelado pelo usuário.' };
          }
          // Continua para fallback GIS
        }
      } else {
        dbg('ETAPA 1 — PULADA (plugin nativo não disponível)', {
          isNative: this.isNative,
          hasPlugin: !!this.googleAuthPlugin
        });
      }

      // ── ETAPA 2: Google Identity Services (GIS) ──────────
      dbg('ETAPA 2 — Verificando GIS (window.google.accounts.id)...', {
        hasWindowGoogle: !!window.google,
        hasAccounts: !!window.google?.accounts,
        hasId: !!window.google?.accounts?.id
      });

      if (window.google && window.google.accounts && window.google.accounts.id) {
        const gisResult = await new Promise((resolve) => {
          let resolved = false;
          const finish = (result) => {
            if (!resolved) {
              resolved = true;
              resolve(result);
            }
          };

          try {
            window.google.accounts.id.initialize({
              client_id: this.clientId,
              auto_select: false,
              callback: (response) => {
                dbg('ETAPA 2 — GIS callback recebido', { hasCredential: !!response?.credential, response });
                if (response && response.credential) {
                  console.log('[DEBUG_1_RAW_GIS_CREDENTIAL]', response.credential);
                  const profile = this.parseGoogleResponse(response.credential);
                  if (profile) {
                    this.saveSession(profile);
                    console.log('[DEBUG_3_GOOGLE_AUTH_SAVED_SESSION]', JSON.stringify(profile, null, 2));
                    finish({ success: true, user: profile });
                    return;
                  }
                }
                finish(null);
              }
            });

            window.google.accounts.id.prompt((notification) => {
              dbg('ETAPA 2 — GIS prompt notification', {
                isNotDisplayed:  notification.isNotDisplayed(),
                isSkippedMoment: notification.isSkippedMoment(),
                isDismissed:     notification.isDismissedMoment(),
                reason:          notification.getNotDisplayedReason?.() || notification.getSkippedReason?.() || 'N/A'
              });

              if (notification.isNotDisplayed() || notification.isSkippedMoment() || notification.isDismissedMoment()) {
                let btnContainer = document.getElementById('gisBtnContainerHidden');
                if (!btnContainer) {
                  btnContainer = document.createElement('div');
                  btnContainer.id = 'gisBtnContainerHidden';
                  btnContainer.style.display = 'none';
                  document.body.appendChild(btnContainer);
                }
                btnContainer.innerHTML = '';
                window.google.accounts.id.renderButton(btnContainer, { type: 'standard', size: 'large' });
                const btnEl = btnContainer.querySelector('div[role=button]') || btnContainer.querySelector('iframe');
                if (btnEl) {
                  btnEl.click();
                } else {
                  finish(null);
                }
              }
            });

            setTimeout(() => {
              dbg('ETAPA 2 — GIS timeout (10s sem resposta)', {});
              finish(null);
            }, 10000);

          } catch (e) {
            dbg('ETAPA 2 — EXCEÇÃO GIS', { message: e?.message, stack: e?.stack, toString: String(e) });
            console.warn('GIS Auth Error:', e);
            finish(null);
          }
        });

        if (gisResult && gisResult.success) {
          return gisResult;
        }
        dbg('ETAPA 2 — GIS não retornou perfil válido', { gisResult });
      }

      // ── ETAPA 3: Supabase OAuth ───────────────────────────
      dbg('ETAPA 3 — Verificando Supabase OAuth...', {
        hasSupabaseRepo: !!window.supabaseRepo,
        hasSupabase:     !!window.supabaseRepo?.supabase
      });

      if (window.supabaseRepo && window.supabaseRepo.supabase) {
        try {
          const redirectUrl = window.location.origin + window.location.pathname;
          dbg('ETAPA 3 — Chamando supabase.auth.signInWithOAuth...', { redirectUrl });
          const { data, error } = await window.supabaseRepo.supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: redirectUrl }
          });
          dbg('ETAPA 3 — Resultado Supabase OAuth', { data, error: error?.message });
          if (!error && data) {
            return { success: true, isRedirecting: true };
          }
        } catch (e) {
          dbg('ETAPA 3 — EXCEÇÃO Supabase OAuth', { message: e?.message, stack: e?.stack, toString: String(e) });
          console.warn('Supabase OAuth Fallback Warning:', e);
        }
      }

      dbg('ETAPA FINAL — Todas as camadas falharam → createSeamlessGoogleSession()', {});
      return await this.createSeamlessGoogleSession();

    } catch (error) {
      dbg('EXCEÇÃO GLOBAL capturada em signIn()', {
        message:  error?.message,
        code:     error?.code,
        error:    error?.error,
        name:     error?.name,
        stack:    error?.stack,
        toString: String(error)
      });
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
