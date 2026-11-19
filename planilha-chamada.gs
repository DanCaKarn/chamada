/**
 * Chamada QR — recebe as presenças do app e grava nesta planilha.
 * Cole este código em Extensões > Apps Script da sua planilha Google,
 * salve e implante como "App da Web" (executar como: Eu; acesso: Qualquer pessoa).
 *
 * Abas:
 *   Alunos      Nome | Matrícula | Turma | Situação (em branco = ativo, ou "Transferido")
 *   Professores Nome | Chave | Ativo       (use o menu "Chamada QR > Novo professor")
 *   Presenças   ID (oculta) | Data | Hora | Matrícula | Nome | Turma | Professor | Forma | Recebido em
 *   Chamadas    Data | Turma | Professor | Finalizada às
 *
 * Toda conversa é um POST em JSON com "acao" e "chave" (contrato no PLANO.md).
 * Sem chave válida e ativa, responde {"ok":false,"erro":"chave"}.
 *
 * Presença: a turma e o nome vêm da aba Alunos, pela matrícula, na hora em que a leitura chega.
 * Não duplica: mesma data + matrícula (ou mesmo ID, no reenvio do celular) → vale a primeira.
 * Matrícula não cadastrada é gravada mesmo assim: Turma = "NÃO CADASTRADA", linha em amarelo.
 * Para ser rápido com muitas linhas, só confere as últimas LINHAS_RECENTES de Presenças.
 */

const ABA_ALUNOS = 'Alunos';
const ABA_PROFESSORES = 'Professores';
const ABA_PRESENCAS = 'Presenças';
const ABA_PRESENCAS_ANTIGA = 'Presenças (antigo)';
const ABA_CHAMADAS = 'Chamadas';

const CAB_ALUNOS = ['Nome', 'Matrícula', 'Turma', 'Situação'];
const CAB_PROFESSORES = ['Nome', 'Chave', 'Ativo'];
const CAB_PRESENCAS = ['ID', 'Data', 'Hora', 'Matrícula', 'Nome', 'Turma', 'Professor', 'Forma', 'Recebido em'];
const CAB_CHAMADAS = ['Data', 'Turma', 'Professor', 'Finalizada às'];

const LINHAS_RECENTES = 2000;
const LINHAS_VALIDACAO = 5000; // quantas linhas da aba Alunos têm a lista suspensa
const NAO_CADASTRADA = 'NÃO CADASTRADA';
const COR_AMARELO = '#fff176';

// ---------------------------------------------------------------- menu

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Chamada QR')
    .addItem('Novo professor', 'novoProfessor')
    .addItem('Preparar abas', 'prepararAbas')
    .addToUi();
}

function prepararAbas() {
  garantirAbas_();
  SpreadsheetApp.getUi().alert('Abas prontas.');
}

function novoProfessor() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Novo professor', 'Nome do professor:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const nome = resp.getResponseText().trim();
  if (!nome) {
    ui.alert('O nome não pode ficar vazio.');
    return;
  }
  garantirAbas_();
  const chave = gerarChave_();
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PROFESSORES);
  const linha = Math.max(2, aba.getLastRow() + 1);
  aba.getRange(linha, 1, 1, 3).setValues([[nome, chave, 'SIM']]);
  ui.alert('Professor criado', 'Nome: ' + nome + '\nChave: ' + chave + '\n\nA chave também está na aba Professores.', ui.ButtonSet.OK);
}

// Chave aleatória de 20 caracteres (a partir de um UUID v4, sem hífens).
function gerarChave_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 20);
}

// ---------------------------------------------------------------- requisições

function doPost(e) {
  const trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    const dados = JSON.parse(e.postData.contents);
    garantirAbas_();

    const professor = professorDaChave_(dados.chave);
    if (professor === null) return responder_({ ok: false, erro: 'chave' });

    switch (dados.acao) {
      case 'teste':
        return responder_({
          ok: true,
          planilha: SpreadsheetApp.getActiveSpreadsheet().getName(),
          professor: professor
        });
      case 'enviar':
        return enviar_(dados.ops || [], professor);
      default:
        return responder_({ ok: false, erro: 'acao' });
    }
  } catch (err) {
    return responder_({ ok: false, erro: String(err) });
  } finally {
    trava.releaseLock();
  }
}

// O contrato é só POST: um GET não devolve nada da planilha.
function doGet() {
  return responder_({ ok: false, erro: 'use POST' });
}

// ---------------------------------------------------------------- ação "enviar"

function enviar_(ops, professor) {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PRESENCAS);
  const recentes = lerRecentes_(aba);
  const ids = new Set();
  const dupla = new Set();
  recentes.linhas.forEach(l => {
    ids.add(String(l[0]));
    dupla.add(chave_(l[1], l[3]));
  });

  const adicoes = ops.filter(op => op && op.op === 'add');
  const alunos = adicoes.length ? mapaAlunos_() : {};
  const fuso = Session.getScriptTimeZone();

  const novas = [];
  const amarelas = []; // posições em "novas" que ficam amarelas
  adicoes.forEach(op => {
    const r = op.reg || op;
    if (!r.id || !r.matricula || !r.data) return;
    const id = String(r.id);
    const matricula = String(r.matricula).trim();
    const data = formatarData_(r.data);
    const k = chave_(data, matricula);
    if (ids.has(id) || dupla.has(k)) return; // já gravada: vale a primeira leitura
    ids.add(id);
    dupla.add(k);

    const aluno = alunos[matricula.toUpperCase()];
    if (!aluno) amarelas.push(novas.length);
    const forma = r.forma === 'QR' ? 'QR' : 'Digitado';
    // "'" na frente guarda data, hora e matrícula como texto (sem perder zeros à esquerda)
    novas.push([
      id, "'" + data, "'" + String(r.hora || ''), "'" + matricula,
      aluno ? aluno.nome : '', aluno ? aluno.turma : NAO_CADASTRADA,
      professor, forma, Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm:ss')
    ]);
  });

  if (novas.length) {
    const primeira = aba.getLastRow() + 1;
    aba.getRange(primeira, 1, novas.length, CAB_PRESENCAS.length).setValues(novas);
    amarelas.forEach(i => aba.getRange(primeira + i, 1, 1, CAB_PRESENCAS.length).setBackground(COR_AMARELO));
  }

  const apagar = ops.filter(op => op && op.op === 'del' && op.id).map(op => String(op.id));
  let apagadas = 0;
  if (apagar.length) {
    const rec = lerRecentes_(aba);
    // apaga de baixo para cima para não bagunçar a numeração das linhas
    for (let i = rec.linhas.length - 1; i >= 0; i--) {
      if (apagar.indexOf(String(rec.linhas[i][0])) >= 0) {
        aba.deleteRow(rec.inicio + i);
        apagadas++;
      }
    }
  }
  return responder_({ ok: true, gravadas: novas.length, apagadas: apagadas });
}

// matrícula (maiúscula) -> { nome, turma }
function mapaAlunos_() {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_ALUNOS);
  const mapa = {};
  const ultima = aba.getLastRow();
  if (ultima < 2) return mapa;
  aba.getRange(2, 1, ultima - 1, 3).getValues().forEach(l => {
    const m = String(l[1]).trim().toUpperCase();
    if (m && !mapa[m]) mapa[m] = { nome: String(l[0]).trim(), turma: String(l[2]).trim() };
  });
  return mapa;
}

// Devolve o nome do professor dono da chave (ativa), ou null.
function professorDaChave_(chave) {
  chave = String(chave || '').trim();
  if (!chave) return null;
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PROFESSORES);
  const ultima = aba.getLastRow();
  if (ultima < 2) return null;
  const linhas = aba.getRange(2, 1, ultima - 1, 3).getValues();
  for (let i = 0; i < linhas.length; i++) {
    if (String(linhas[i][1]).trim() === chave && String(linhas[i][2]).trim().toUpperCase() === 'SIM') {
      return String(linhas[i][0]).trim() || 'Professor';
    }
  }
  return null;
}

// ---------------------------------------------------------------- abas

// Leve: só cria o que falta (aba, cabeçalho, formato, validação). Se a aba já existe, não mexe nela.
function garantirAbas_() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();

  if (!planilha.getSheetByName(ABA_ALUNOS)) {
    const aba = planilha.insertSheet(ABA_ALUNOS);
    cabecalho_(aba, CAB_ALUNOS);
    aba.getRange(2, 2, LINHAS_VALIDACAO, 1).setNumberFormat('@'); // matrícula como texto
    aba.getRange(2, 4, LINHAS_VALIDACAO, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Transferido'], true).setAllowInvalid(false).build()
    );
  }

  if (!planilha.getSheetByName(ABA_PROFESSORES)) {
    const aba = planilha.insertSheet(ABA_PROFESSORES);
    cabecalho_(aba, CAB_PROFESSORES);
    aba.getRange(2, 2, LINHAS_VALIDACAO, 1).setNumberFormat('@'); // chave como texto
  }

  if (!planilha.getSheetByName(ABA_CHAMADAS)) {
    cabecalho_(planilha.insertSheet(ABA_CHAMADAS), CAB_CHAMADAS);
  }

  // Presenças: se ainda está no formato antigo (tem a coluna "Código"), guarda como "Presenças (antigo)".
  let pres = planilha.getSheetByName(ABA_PRESENCAS);
  if (pres && String(pres.getRange(1, 1, 1, Math.min(9, pres.getMaxColumns())).getValues()[0]).indexOf('Código') >= 0) {
    let nome = ABA_PRESENCAS_ANTIGA;
    if (planilha.getSheetByName(nome)) {
      nome += ' ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss');
    }
    pres.setName(nome);
    pres = null;
  }
  if (!pres && !planilha.getSheetByName(ABA_PRESENCAS)) {
    const aba = planilha.insertSheet(ABA_PRESENCAS);
    cabecalho_(aba, CAB_PRESENCAS);
    aba.setColumnWidth(1, 60);
    aba.hideColumns(1); // o ID é só para controle do app
  }
}

function cabecalho_(aba, titulos) {
  aba.getRange(1, 1, 1, titulos.length).setValues([titulos]).setFontWeight('bold');
  aba.setFrozenRows(1);
}

// ---------------------------------------------------------------- apoio

// Lê só as últimas LINHAS_RECENTES linhas (colunas ID a Matrícula).
// Devolve a primeira linha lida (número na planilha) e os valores.
function lerRecentes_(aba) {
  const ultima = aba.getLastRow();
  if (ultima < 2) return { inicio: 2, linhas: [] };
  const inicio = Math.max(2, ultima - LINHAS_RECENTES + 1);
  return { inicio: inicio, linhas: aba.getRange(inicio, 1, ultima - inicio + 1, 4).getValues() };
}

// Chave de duplicidade: data + matrícula.
function chave_(data, matricula) {
  if (data instanceof Date) data = Utilities.formatDate(data, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return [data, matricula].map(v => String(v).trim().toUpperCase()).join('|');
}

function formatarData_(iso) {
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
