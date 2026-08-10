/**
 * ============================================================================
 * LINSORA — ENGINE DE RECONHECIMENTO DE VOZ (voice-recognition.js)
 * Gerenciamento de permissões de microfone e Web Speech API nativa
 * ============================================================================
 */

class VoiceRecognitionEngine {
  constructor() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.isSupported = !!SpeechRecognition;
    this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
    this.isListening = false;

    if (this.recognition) {
      this.recognition.lang = 'pt-BR';
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
    }
  }

  /**
   * Solicita permissão explícita de microfone ao navegador/aparelho.
   * @returns {Promise<boolean>}
   */
  async requestPermission() {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Encerra a stream temporária após obter permissão
        stream.getTracks().forEach(track => track.stop());
        return true;
      }
      return this.isSupported;
    } catch (err) {
      console.warn('⚠️ Permissão de microfone negada ou indisponível:', err);
      return false;
    }
  }

  /**
   * Inicia o reconhecimento de voz com escutadores de eventos.
   * @param {Object} callbacks { onStart, onResult, onError, onEnd }
   */
  async startListening({ onStart, onResult, onError, onEnd }) {
    if (!this.isSupported) {
      if (onError) onError('Reconhecimento de voz não suportado neste navegador.');
      return false;
    }

    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      if (onError) onError('Permissão de microfone negada pelo usuário.');
      return false;
    }

    if (this.isListening) {
      this.stopListening();
    }

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
        console.warn('⚠️ Erro no reconhecimento de voz:', event.error);
        this.isListening = false;
        let msg = 'Erro ao reconhecer voz.';
        if (event.error === 'not-allowed') msg = 'Permissão do microfone negada.';
        if (event.error === 'no-speech') msg = 'Nenhuma fala detectada. Tente falar novamente.';
        if (event.error === 'network') msg = 'Erro de conexão de rede no serviço de voz.';

        if (onError) onError(msg, event.error);
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (onEnd) onEnd();
      };

      this.recognition.start();
      return true;
    } catch (err) {
      console.error('❌ Falha ao iniciar reconhecimento de voz:', err);
      this.isListening = false;
      if (onError) onError('Não foi possível ativar o microfone.');
      return false;
    }
  }

  /**
   * Encerra a escuta ativa do microfone.
   */
  stopListening() {
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
