/**
 * ============================================================================
 * LINSORA — CAMADA DE CLIENTE & REPOSITÓRIO SUPABASE AUTH (supabase-client.js)
 * Fluxo de Autenticação Oficial, Logout Seguro e Sincronização PostgreSQL / RLS
 * ============================================================================
 */

class SupabaseRepository {
  constructor() {
    this.configKey = 'LINSORA_SUPABASE_CONFIG';
    this.config = this.getSupabaseConfig();
    this.supabase = null;
    this.currentUserId = 'guest';
    
    this.initSupabaseSDK();
  }

  /**
   * Inicializa o cliente oficial do Supabase JS SDK se houver credenciais
   */
  initSupabaseSDK() {
    if (this.config.url && this.config.key && window.supabase) {
      try {
        this.supabase = window.supabase.createClient(this.config.url, this.config.key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        console.log('⚡ Supabase Client SDK inicializado com suporte estrito a RLS!');
      } catch (e) {
        console.warn('Erro ao inicializar Supabase SDK:', e);
      }
    }
  }

  getSupabaseConfig() {
    try {
      const stored = localStorage.getItem(this.configKey);
      return stored ? JSON.parse(stored) : { url: '', key: '', isConnected: false };
    } catch (e) {
      return { url: '', key: '', isConnected: false };
    }
  }

  saveSupabaseConfig(url, key) {
    this.config = { url, key, isConnected: Boolean(url && key) };
    localStorage.setItem(this.configKey, JSON.stringify(this.config));
    this.initSupabaseSDK();
    return this.config;
  }

  /* ------------------------------------------------------------------------
     AUTENTICAÇÃO E SESSÃO DO USUÁRIO
     ------------------------------------------------------------------------ */

  async checkActiveSession() {
    if (this.supabase) {
      try {
        const { data: { session }, error } = await this.supabase.auth.getSession();
        if (error) throw error;
        
        if (session && session.user) {
          this.currentUserId = session.user.id;
          const userMeta = session.user.user_metadata || {};
          const db = await this.getDbData(session.user.id, {
            id: session.user.id,
            name: userMeta.full_name || userMeta.name || session.user.email.split('@')[0],
            email: session.user.email,
            avatar: userMeta.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'
          });
          return { success: true, user: db.user, db };
        }
      } catch (e) {
        console.warn('Sessão ativa não encontrada:', e);
      }
    }
    return { success: false };
  }

  async signInWithGoogleOAuth() {
    if (this.supabase) {
      try {
        const redirectUrl = window.location.origin + window.location.pathname;
        const { data, error } = await this.supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: redirectUrl }
        });
        if (error) throw error;
        return { success: true, data };
      } catch (err) {
        return { success: false, message: this.mapAuthErrorMessage(err.message) };
      }
    }

    // Fallback seguro em modo de desenvolvimento local caso chaves não estejam injetadas
    const guestUser = { id: 'usr_google_demo', name: 'Usuário Google', email: 'usuario@google.com' };
    this.currentUserId = guestUser.id;
    const db = await this.getDbData(guestUser.id, guestUser);
    return { success: true, user: db.user, isDemoNotice: true };
  }

  async signInWithEmail(email, password) {
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        this.currentUserId = data.user.id;
        const db = await this.getDbData(data.user.id, { id: data.user.id, email: data.user.email, name: email.split('@')[0] });
        return { success: true, user: db.user };
      } catch (err) {
        return { success: false, message: this.mapAuthErrorMessage(err.message) };
      }
    }

    const userId = 'usr_' + btoa(email).replace(/=/g, '').slice(0, 10);
    this.currentUserId = userId;
    const db = await this.getDbData(userId, { id: userId, email, name: email.split('@')[0] });
    return { success: true, user: db.user };
  }

  async signUpWithEmail(name, email, password) {
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } }
        });
        if (error) throw error;
        this.currentUserId = data.user.id;
        const db = await this.getDbData(data.user.id, { id: data.user.id, email, name });
        return { success: true, user: db.user };
      } catch (err) {
        return { success: false, message: this.mapAuthErrorMessage(err.message) };
      }
    }

    const userId = 'usr_' + btoa(email).replace(/=/g, '').slice(0, 10);
    this.currentUserId = userId;
    const db = await this.getDbData(userId, { id: userId, email, name: name || email.split('@')[0] });
    return { success: true, user: db.user };
  }

  async signOut() {
    if (this.supabase) {
      try {
        await this.supabase.auth.signOut();
      } catch (e) {
        console.warn('Erro ao encerrar sessão Supabase:', e);
      }
    }
    this.currentUserId = 'guest';
  }

  async resetPassword(email) {
    if (this.supabase) {
      try {
        const { error } = await this.supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        return { success: true, message: 'Link de redefinição enviado para o seu e-mail!' };
      } catch (err) {
        return { success: false, message: this.mapAuthErrorMessage(err.message) };
      }
    }
    return { success: true, message: 'Solicitação de recuperação de senha enviada.' };
  }

  mapAuthErrorMessage(msg) {
    if (!msg) return 'Ocorreu um erro na autenticação.';
    const lower = msg.toLowerCase();
    if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
      return 'E-mail ou senha incorretos.';
    }
    if (lower.includes('user already registered') || lower.includes('already_exists')) {
      return 'Este e-mail já está cadastrado. Faça login para acessar.';
    }
    if (lower.includes('password should be at least')) {
      return 'A senha deve conter no mínimo 6 caracteres.';
    }
    return msg;
  }

  /* ------------------------------------------------------------------------
     BANCO DE DADOS ISOLADO POR USUÁRIO (ESTADO INICIAL 100% ZERADO E RLS)
     ------------------------------------------------------------------------ */

  getEmptyUserData(userObj) {
    return {
      user: {
        id: userObj?.id || 'usr_guest',
        name: userObj?.name || 'Novo Usuário',
        email: userObj?.email || 'usuario@linsora.com.br',
        avatar: userObj?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
        plan: 'PRO',
        isPinEnabled: false,
        pinCode: '1234',
        isAiClassificationEnabled: true
      },
      accounts: [],
      cards: [],
      pixKeys: [],
      goals: [],
      fixedBills: [],
      transactions: []
    };
  }

  async getDbData(userId, userObj = null) {
    const activeId = userId || this.currentUserId || 'guest';

    // Se estiver conectado ao Supabase remoto, busca via PostgREST/RLS
    if (this.supabase && activeId !== 'guest' && !activeId.startsWith('usr_')) {
      try {
        const [accRes, cardsRes, txRes, goalsRes, pixRes, billsRes] = await Promise.all([
          this.supabase.from('accounts').select('*').eq('user_id', activeId),
          this.supabase.from('cards').select('*').eq('user_id', activeId),
          this.supabase.from('transactions').select('*').eq('user_id', activeId).order('date', { ascending: false }),
          this.supabase.from('goals').select('*').eq('user_id', activeId),
          this.supabase.from('pix_keys').select('*').eq('user_id', activeId),
          this.supabase.from('fixed_bills').select('*').eq('user_id', activeId)
        ]);

        const remoteData = {
          user: {
            id: activeId,
            name: userObj?.name || 'Usuário',
            email: userObj?.email || 'usuario@linsora.com.br',
            avatar: userObj?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
            plan: 'PRO',
            isPinEnabled: false,
            pinCode: '1234',
            isAiClassificationEnabled: true
          },
          accounts: accRes.data || [],
          cards: cardsRes.data || [],
          transactions: txRes.data || [],
          goals: goalsRes.data || [],
          pixKeys: pixRes.data || [],
          fixedBills: billsRes.data || []
        };

        const key = `LINSORA_DB_CACHE_${activeId}`;
        localStorage.setItem(key, JSON.stringify(remoteData));
        return remoteData;
      } catch (err) {
        console.warn('Fallback para cache local isolado:', err);
      }
    }

    const key = `LINSORA_DB_CACHE_${activeId}`;
    const stored = localStorage.getItem(key);
    
    if (stored) {
      const data = JSON.parse(stored);
      // Garantir que o id do estado bata com o id autenticado
      data.user.id = activeId;
      if (userObj) {
        data.user.name = userObj.name || data.user.name;
        data.user.email = userObj.email || data.user.email;
        if (userObj.avatar) data.user.avatar = userObj.avatar;
      }
      return data;
    }

    const emptyState = this.getEmptyUserData(userObj);
    localStorage.setItem(key, JSON.stringify(emptyState));
    return emptyState;
  }

  async saveDbData(data, userId = null) {
    const targetId = userId || data?.user?.id || this.currentUserId || 'guest';
    const key = `LINSORA_DB_CACHE_${targetId}`;
    
    // Forçar que o objeto do usuário sempre tenha o id correto
    if (data && data.user) {
      data.user.id = targetId;
    }

    localStorage.setItem(key, JSON.stringify(data));
    return data;
  }
}

window.supabaseRepo = new SupabaseRepository();
