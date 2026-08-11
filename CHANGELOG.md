# CHANGELOG — Linsora Finanças

Todas as alterações notáveis, correções e melhorias de UX/UI neste projeto serão documentadas neste arquivo.## [1.0.3] - 2026-08-11

### 📷 Upload & Gestão de Foto de Perfil
- **Fluxo Completo de Foto**: Permite selecionar da galeria ou tirar foto na tela Perfil & Configurações.
- **Compressão & Redimensionamento Client-Side**: Redimensionamento proporcional (máx. 300x300px) e compressão Canvas JPEG (qualidade 0.8) antes de salvar.
- **Supabase Storage Sync**: Upload automático para o bucket `avatars` no Supabase com fallback para imagem de cache local.
- **Indicador Visual de Carregamento**: Adicionado spinner animado e overlay interativo no avatar.

### 🎨 Refinamento Visual & Componentes Premium
- **Cleanup na Aba Perfil**: Removido o card de "Relatório financeiro PDF" e ocultado o botão FAB de microfone ao navegar para a aba Perfil, otimizando o espaçamento vertical.
- **Cards de Saúde Financeira Premium**: Redesenho de "Comprometimento de Renda" e "Margem de Poupança" com badges de status coloridos, ícones dedicados e micro-barras de progresso fluidas.
- **Card Hero — Maior Ofensor Orçamentário**: Redesenho completo do diagnóstico de ofensor com gradiente de alerta vermelho/dark, métricas de impacto no orçamento/renda e Dica Prática de Redução de Gastos personalizada por categoria.
- **Padronização do Design System**: Harmonização global de cards, glassmorphism e espaçamentos.

## [1.0.2] - 2026-08-11

### 💾 Persistência de Dados & Sincronização Supabase Sem Perdas
- **Restauração Automática por E-mail**: Implementado mapeamento determinístico de chave de usuário e sessão local vinculados ao e-mail, garantindo a recuperação completa de contas, cartões, metas, receitas, despesas e preferências (`isHideValues`, `currentTheme`, `isPinEnabled`, `pinCode`, `isAiClassificationEnabled`) ao atualizar a APK ou fazer relogin.
- **Migração Automática de Visitante**: Implementada migração transparente de dados criados antes da autenticação para o perfil do usuário logado.
- **Auto-Sync Supabase Remote**: Implementada sincronização bi-direcional inteligente com tabelas do Supabase e mesclagem por ID sem perda de registros locais.
- **Compatibilidade de APK & Application ID**: Verificada compatibilidade de `com.linsora.app`, mantendo o mesmo identificador de aplicativo e chave de assinatura para atualizações transparentes no Android.
- **APK Versionada**: Nova versão gerada como `LINSORA-Financas-v1.0.2.apk` preservando builds anteriores.

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
