/**
 * ============================================================================
 * LINSORA — TEMPLATES DE E-MAIL DE AUTENTICAÇÃO (server-side)
 * Usados por api/send-auth-email.js (Supabase Send Email Hook → Resend).
 * ============================================================================
 *
 * - Somente apresentação: nenhum segredo, token ou dado financeiro aqui.
 * - Links (confirmUrl/recoveryUrl) são montados pelo handler a partir dos
 *   dados oficiais do payload do Supabase (token_hash + redirect_to).
 * - Todo texto interpolado passa por escapeHtml.
 */
'use strict';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function firstNameOf(fullName, email) {
  const base = String(fullName || '').trim().split(/\s+/)[0];
  if (base) return base;
  const local = String(email || '').split('@')[0].trim();
  return local || 'bem-vindo';
}

// Layout único (dark Linsora): tabela simples p/ clientes de e-mail.
function layout({ heading, introHtml, ctaUrl, ctaLabel, outroHtml }) {
  const cta = ctaUrl
    ? '<p style="margin:28px 0;text-align:center;">' +
      '<a href="' + escapeHtml(ctaUrl) + '" style="display:inline-block;padding:14px 28px;border-radius:10px;background:#10B981;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;">' +
      escapeHtml(ctaLabel) + '</a></p>'
    : '';
  const outro = outroHtml ? '<p style="color:#94A3B8;font-size:13px;line-height:1.6;">' + outroHtml + '</p>' : '';
  return (
    '<div style="background-color:#070B12;padding:32px 16px;">' +
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#F8FAFC;max-width:560px;margin:0 auto;background-color:#111C30;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px 28px;">' +
    '<p style="font-size:13px;font-weight:800;letter-spacing:2px;color:#10B981;margin:0 0 20px;">LINSORA</p>' +
    '<h1 style="font-size:22px;margin:0 0 16px;">' + escapeHtml(heading) + '</h1>' +
    introHtml +
    cta +
    outro +
    '<p style="color:#64748B;font-size:12px;margin-top:28px;">Equipe Linsora</p>' +
    '</div></div>'
  );
}

function styledParagraph(text) {
  return '<p style="font-size:15px;line-height:1.7;color:#E2E8F0;">' + escapeHtml(text) + '</p>';
}

function buildSignup({ name, confirmUrl }) {
  const subject = 'Confirme seu cadastro no Linsora';
  const text =
    'Olá, ' + name + '!\n\n' +
    'Você criou uma conta no Linsora. Confirme seu endereço de e-mail para concluir seu cadastro:\n\n' +
    confirmUrl + '\n\n' +
    'Se você não criou essa conta, ignore este e-mail.\n\n' +
    'Equipe Linsora';
  const html = layout({
    heading: 'Olá, ' + name + '!',
    introHtml:
      styledParagraph('Você criou uma conta no Linsora.') +
      styledParagraph('Confirme seu endereço de e-mail para concluir seu cadastro.'),
    ctaUrl: confirmUrl,
    ctaLabel: 'Confirmar meu e-mail',
    outroHtml: 'Se você não criou essa conta, ignore este e-mail.',
  });
  return { subject, text, html };
}

function buildRecovery({ recoveryUrl }) {
  const subject = 'Redefina sua senha do Linsora';
  const text =
    'Recebemos uma solicitação para redefinir a senha da sua conta Linsora.\n\n' +
    'Escolha uma nova senha aqui:\n\n' +
    recoveryUrl + '\n\n' +
    'Se você não solicitou isso, ignore este e-mail com segurança.\n\n' +
    'Equipe Linsora';
  const html = layout({
    heading: 'Redefina sua senha',
    introHtml: styledParagraph('Recebemos uma solicitação para redefinir a senha da sua conta Linsora.'),
    ctaUrl: recoveryUrl,
    ctaLabel: 'Redefinir minha senha',
    outroHtml: 'Se você não solicitou isso, ignore este e-mail com segurança.',
  });
  return { subject, text, html };
}

function buildPasswordChanged() {
  const subject = 'Sua senha foi alterada no Linsora';
  const text =
    'A senha da sua conta Linsora foi alterada.\n\n' +
    'Se você não realizou essa alteração, recomendamos redefinir sua senha imediatamente pela tela de login do aplicativo.\n\n' +
    'Equipe Linsora';
  const html = layout({
    heading: 'Senha alterada',
    introHtml:
      styledParagraph('A senha da sua conta Linsora foi alterada.') +
      styledParagraph('Se você não realizou essa alteração, recomendamos redefinir sua senha imediatamente pela tela de login do aplicativo.'),
    ctaUrl: null,
    ctaLabel: null,
    outroHtml: null,
  });
  return { subject, text, html };
}

function buildEmailChange({ newEmail, confirmUrl, toOldAddress }) {
  const subject = 'Confirme a alteração de e-mail no Linsora';
  const text = toOldAddress
    ? 'Recebemos uma solicitação para alterar o e-mail da sua conta Linsora.\n\n' +
      'Se você não solicitou isso, recomendamos redefinir sua senha imediatamente pela tela de login do aplicativo.\n\n' +
      'Equipe Linsora'
    : 'Confirme seu novo endereço de e-mail (' + newEmail + ') para concluir a alteração da sua conta Linsora:\n\n' +
      confirmUrl + '\n\n' +
      'Se você não solicitou isso, ignore este e-mail.\n\n' +
      'Equipe Linsora';
  const html = layout({
    heading: toOldAddress ? 'Alteração de e-mail solicitada' : 'Confirme seu novo e-mail',
    introHtml: toOldAddress
      ? styledParagraph('Recebemos uma solicitação para alterar o e-mail da sua conta Linsora.') +
        styledParagraph('Se você não solicitou isso, recomendamos redefinir sua senha imediatamente pela tela de login do aplicativo.')
      : styledParagraph('Confirme seu novo endereço de e-mail para concluir a alteração da sua conta Linsora.'),
    ctaUrl: toOldAddress ? null : confirmUrl,
    ctaLabel: toOldAddress ? null : 'Confirmar novo e-mail',
    outroHtml: toOldAddress ? null : 'Se você não solicitou isso, ignore este e-mail.',
  });
  return { subject, text, html };
}

module.exports = {
  escapeHtml,
  firstNameOf,
  buildSignup,
  buildRecovery,
  buildPasswordChanged,
  buildEmailChange,
};
