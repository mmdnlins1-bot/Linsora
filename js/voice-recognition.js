/**
 * ============================================================================
 * LINSORA — ENGINE DE RECONHECIMENTO DE VOZ (voice-recognition.js)
 * Gerenciamento de permissões de microfone e Web Speech API nativa
 * Compatível com Capacitor (Android WebView) e navegadores desktop
 * ============================================================================
 */

class VoiceRecognitionEngine {
  constructor() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.isSupported = !!SpeechRecognition;
    this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
    this.isListening = false;
    // ETAPA 6C: timer de segurança (limite máximo de captura contínua).
    this.safetyTimer = null;
    this.safetyTimeoutMs = 30000;
    this.timedOut = false;

    if (this.recognition) {
      this.recognition.lang = 'pt-BR';
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
    }
  }

  /**
   * Detecta se o app está rodando dentro de um WebView do Capacitor/Android.
   * @returns {boolean}
   */
  _isCapacitorAndroid() {
    return !!(window.Capacitor && window.Capacitor.getPlatform &&
              window.Capacitor.getPlatform() === 'android');
  }

  /**
   * Traduz o código de erro da Web Speech API para uma mensagem amigável em PT-BR,
   * incluindo o código técnico para facilitar o diagnóstico.
   * @param {string} errorCode - event.error da Web Speech API
   * @param {string|null} nativeMessage - mensagem nativa adicional, se disponível
   * @returns {string}
   */
  _translateError(errorCode, nativeMessage) {
    const errorMap = {
      'not-allowed':       'Permissão de microfone negada. Verifique as permissões nas Configurações do app.',
      'no-speech':         'Nenhuma fala detectada. Aproxime o microfone e tente novamente.',
      'audio-capture':     'Microfone não encontrado ou ocupado por outro aplicativo.',
      'network':           'Erro de rede no serviço de reconhecimento de voz. Verifique sua conexão.',
      'aborted':           'Reconhecimento cancelado.',
      'service-not-allowed': 'Serviço de voz não permitido neste contexto.',
      'bad-grammar':       'Gramática de voz inválida (erro interno).',
      'language-not-supported': 'Idioma pt-BR não suportado neste dispositivo.',
    };

    const friendly = errorMap[errorCode] || `Erro de voz desconhecido: ${errorCode}.`;
    const detail = nativeMessage && nativeMessage !== errorCode
      ? ` [Detalhe: ${nativeMessage}]`
      : ` [código: ${errorCode}]`;

    return friendly + detail;
  }

  /**
   * Solicita permissão explícita de microfone ao navegador/aparelho.
   * No Android/Capacitor, o WebChromeClient intercepta esta chamada e
   * exibe o diálogo nativo de permissão do sistema.
   * @returns {Promise<{granted: boolean, reason: string|null}>}
   */
  async requestPermission() {
    // Verifica se o contexto é seguro (HTTPS ou Capacitor)
    if (location.protocol !== 'https:' &&
        !this._isCapacitorAndroid() &&
        location.hostname !== 'localhost') {
      return { granted: false, reason: 'Contexto inseguro: microfone requer HTTPS.' };
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // Sem API getUserMedia — em alguns WebViews antigos
      if (this.isSupported) {
        // Permite tentar diretamente via SpeechRecognition (que tem seu próprio prompt)
        return { granted: true, reason: null };
      }
      return { granted: false, reason: 'API de mídia não disponível neste dispositivo.' };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Encerra a stream temporária — ela serviu apenas para acionar o prompt de permissão
      stream.getTracks().forEach(track => track.stop());
      return { granted: true, reason: null };
    } catch (err) {
      console.warn('⚠️ Falha ao solicitar permissão de microfone:', err.name, err.message);

      let reason;
      switch (err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          reason = `Permissão negada pelo usuário ou pelo sistema. [${err.name}]`;
          break;
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          reason = `Nenhum microfone encontrado no dispositivo. [${err.name}]`;
          break;
        case 'NotReadableError':
        case 'TrackStartError':
          reason = `Microfone ocupado por outro aplicativo. [${err.name}]`;
          break;
        case 'OverconstrainedError':
          reason = `Restrições de áudio incompatíveis. [${err.name}]`;
          break;
        case 'SecurityError':
          reason = `Acesso bloqueado por política de segurança. [${err.name}]`;
          break;
        case 'TypeError':
          reason = `Parâmetros inválidos na solicitação de áudio. [${err.name}]`;
          break;
        default:
          reason = `${err.message || err.name || 'Erro desconhecido'} [${err.name}]`;
      }

      return { granted: false, reason };
    }
  }

  /**
   * Limpa o timer de segurança, se existir. Idempotente.
   */
  _clearSafetyTimer() {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
  }

  /**
   * Inicia o reconhecimento de voz com escutadores de eventos.
   * @param {Object} callbacks { onStart, onResult, onError, onEnd }
   */
  async startListening({ onStart, onResult, onError, onEnd }) {
    if (!this.isSupported) {
      if (onError) onError('Reconhecimento de voz não suportado neste navegador ou dispositivo.');
      return false;
    }

    const { granted, reason } = await this.requestPermission();
    if (!granted) {
      const msg = reason || 'Permissão de microfone não concedida.';
      console.warn('⚠️ Permissão negada:', msg);
      if (onError) onError(msg);
      return false;
    }

    if (this.isListening) {
      // ETAPA 6C: captura já ativa — não inicia outra em paralelo.
      // Retorno silencioso: a UI já exibe o estado "ouvindo".
      return false;
    }

    this._clearSafetyTimer();
    this.timedOut = false;

    try {
      this.recognition.onstart = () => {
        this.isListening = true;
        if (onStart) onStart();
      };

      this.recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const currentText = finalTranscript || interimTranscript;
        const isFinal = !!finalTranscript;

        if (onResult && currentText) {
          onResult(currentText, isFinal);
        }
      };

      this.recognition.onerror = (event) => {
        this.isListening = false;
        this._clearSafetyTimer();

        // Captura mensagem nativa adicional se disponível
        const nativeMsg = event.message || null;
        const friendlyMsg = this._translateError(event.error, nativeMsg);

        console.warn('⚠️ Erro no reconhecimento de voz:', event.error, nativeMsg || '');

        if (onError) onError(friendlyMsg, event.error);
      };

      this.recognition.onend = () => {
        this.isListening = false;
        this._clearSafetyTimer();
        if (onEnd) onEnd();
      };

      this.recognition.start();

      // ETAPA 6C: timeout próprio de segurança (30s). Não há retry automático.
      this._clearSafetyTimer();
      this.safetyTimer = setTimeout(() => {
        this.safetyTimer = null;
        this.timedOut = true;
        this.stopListening();
        if (onError) onError('Não consegui concluir a captura de voz. Tente novamente.');
      }, this.safetyTimeoutMs);

      return true;
    } catch (err) {
      console.error('❌ Falha ao iniciar reconhecimento de voz:', err);
      this.isListening = false;
      const msg = `Não foi possível ativar o microfone: ${err.message || err.name || 'erro desconhecido'}.`;
      if (onError) onError(msg);
      return false;
    }
  }

  /**
   * Encerra a escuta ativa do microfone.
   */
  stopListening() {
    // ETAPA 6C: encerrar a escuta sempre limpa o timer de segurança.
    this._clearSafetyTimer();
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        console.log('Parando escuta:', e);
      }
      this.isListening = false;
    }
  }
}

window.VoiceRecognitionEngine = new VoiceRecognitionEngine();
