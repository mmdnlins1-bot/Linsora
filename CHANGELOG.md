# CHANGELOG — Linsora Finanças

Todas as alterações notáveis, correções e melhorias de UX/UI neste projeto serão documentadas neste arquivo.

## [1.0.0] - 2026-08-11

### 🚀 Correções de Permissões Android & Reconhecimento de Voz
- **Android Runtime Permission**: Declaradas permissões `android.permission.RECORD_AUDIO` e `android.permission.MODIFY_AUDIO_SETTINGS` no `AndroidManifest.xml`.
- **Custom WebChromeClient**: Implementado override de `onPermissionRequest` em `MainActivity.java` para interceptar e autorizar solicitações de microfone dentro da WebView do Capacitor.
- **Tratamento de Erros Granular**: Atualizado `voice-recognition.js` para capturar exceções DOM e exibir mensagens claras e reais do motivo da falha (como bloqueio de mídia ou ausência de microfone) ao invés de mensagens genéricas.

### 🎨 Refatoração de UI/UX & Design System Linsora
- **Dashboard Cleanup**: Removido o card "Fluxo de Caixa Real" da tela inicial e unificado o layout com `.section-block` para evitar lacunas de espaço.
- **Ajuste no Card de Confirmação da Meta por Voz**: Corrigido o container `#voice-conf-amount-box` e `.voice-conf-amount-val` para usar tipografia fluida `clamp()` com quebra responsiva de linha, garantindo que o "Valor Alvo" fique dentro do card em telas de qualquer resolução.
- **Modal Nativo de Confirmação**: Criado o modal nativo `#modalConfirmDelete` (substituindo o `window.confirm` do navegador) com título "Confirmar exclusão", mensagem dinâmica personalizada, animação de slide-up, fundo escurecido (`backdrop-filter`) e botões de ação estilizados.
- **Padronização de Botões & Componentes**: Implementadas classes flexíveis `.linsora-btn` (`primary`, `secondary`, `outline`, `danger`) com suporte a Dark e Light Mode.

### 🧪 Auditoria de Qualidade & Testes Automáticos
- Atualizada e executada a suíte Playwright completa (`72/72 passed`).
- Compilada nova build de produção do aplicativo Android: `LINSORA-Financas.apk`.
