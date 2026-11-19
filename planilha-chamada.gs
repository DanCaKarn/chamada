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
 *
 * Ações: teste, enviar, alunos, status, finalizar.
 *   alunos     todos os alunos (inclusive transferidos, s = "Transferido").
 *   status     por turma, numa data: total de ativos, presentes, ausentes e se está finalizada.
 *   finalizar  grava a turma em Chamadas; se já estava finalizada naquela data, não duplica.
 * Só enviar e finalizar escrevem, e só elas usam a trava; as demais só leem e não esperam ninguém.
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

const ACOES_ESCRITA = ['enviar', 'finalizar'];

function doPost(e) {
  try {
    const dados = JSON.parse(e.postData.contents);
    if (ACOES_ESCRITA.indexOf(dados.acao) >= 0) {
      return comTrava_(() => tratar_(dados, true));
    }
    // Só leitura: sem trava. Só trava se faltar criar alguma aba.
    if (!abasProntas_()) comTrava_(garantirAbas_);
    return tratar_(dados, false);
  } catch (err) {
    return responder_({ ok: false, erro: String(err) });
  }
}

function comTrava_(fn) {
  const trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    return fn();
  } finally {
    trava.releaseLock();
  }
}

function tratar_(dados, escrita) {
  if (escrita) garantirAbas_();

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
    case 'alunos':
      return alunos_();
    case 'status':
      return status_(dados.data);
    case 'finalizar':
      return finalizar_(dados.turma, dados.data, professor);
    default:
      return responder_({ ok: false, erro: 'acao' });
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

// ---------------------------------------------------------------- ação "alunos"

function alunos_() {
  return responder_({ ok: true, alunos: lerAlunos_() });
}

// Todos os alunos, inclusive transferidos. Matrícula repetida: vale a primeira.
function lerAlunos_() {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_ALUNOS);
  const ultima = aba.getLastRow();
  if (ultima < 2) return [];
  const vistos = new Set();
  const lista = [];
  aba.getRange(2, 1, ultima - 1, 4).getValues().forEach(l => {
    const m = String(l[1]).trim();
    if (!m || vistos.has(m.toUpperCase())) return;
    vistos.add(m.toUpperCase());
    const transferido = String(l[3]).trim().toUpperCase() === 'TRANSFERIDO';
    lista.push({ m: m, n: String(l[0]).trim(), t: String(l[2]).trim(), s: transferido ? 'Transferido' : '' });
  });
  return lista;
}

// ---------------------------------------------------------------- ação "status"

function status_(iso) {
  if (!dataValida_(iso)) return responder_({ ok: false, erro: 'data' });
  const data = formatarData_(iso);
  const planilha = SpreadsheetApp.getActiveSpreadsheet();

  // matrículas com presença nessa data
  const presentes = new Set();
  lerRecentes_(planilha.getSheetByName(ABA_PRESENCAS)).linhas.forEach(l => {
    if (dataTexto_(l[1]) === data) presentes.add(String(l[3]).trim().toUpperCase());
  });

  const finalizadas = finalizadasDaData_(data);

  // agrupa por turma (sem diferenciar maiúsculas)
  const turmas = {};
  lerAlunos_().forEach(a => {
    if (!a.t) return;
    const k = a.t.toUpperCase();
    if (!turmas[k]) turmas[k] = { nome: a.t, alunos: [] };
    turmas[k].alunos.push(a);
  });

  const resultado = Object.keys(turmas).sort().map(k => {
    const g = turmas[k];
    const fin = finalizadas[k] || null;
    const ativos = g.alunos.filter(a => a.s !== 'Transferido');
    const comPresenca = g.alunos.some(a => presentes.has(a.m.toUpperCase())); // transferido também vale
    const semChamada = !comPresenca && !fin;
    const presentesAtivos = ativos.filter(a => presentes.has(a.m.toUpperCase())).length;
    return {
      turma: g.nome,
      total: ativos.length,
      presentes: presentesAtivos,
      sem_chamada: semChamada,
      ausentes: semChamada ? [] : ativos.filter(a => !presentes.has(a.m.toUpperCase())).map(a => ({ m: a.m, n: a.n })),
      finalizada: fin
    };
  });
  return responder_({ ok: true, data: iso, turmas: resultado });
}

// turma (maiúscula) -> { hora, professor }, das chamadas finalizadas na data
function finalizadasDaData_(data) {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_CHAMADAS);
  const mapa = {};
  lerRecentes_(aba).linhas.forEach(l => {
    if (dataTexto_(l[0]) !== data) return;
    const k = String(l[1]).trim().toUpperCase();
    if (!mapa[k]) mapa[k] = { hora: horaTexto_(l[3]), professor: String(l[2]).trim() };
  });
  return mapa;
}

// ---------------------------------------------------------------- ação "finalizar"

function finalizar_(turma, iso, professor) {
  if (!dataValida_(iso)) return responder_({ ok: false, erro: 'data' });
  const pedida = String(turma || '').trim().toUpperCase();
  const alvo = lerAlunos_().filter(a => a.t.toUpperCase() === pedida)[0];
  if (!pedida || !alvo) return responder_({ ok: false, erro: 'turma' });

  const data = formatarData_(iso);
  const existente = finalizadasDaData_(data)[pedida];
  if (existente) {
    return responder_({ ok: true, ja_finalizada: true, professor: existente.professor, hora: existente.hora });
  }

  const hora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss');
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_CHAMADAS);
  aba.getRange(aba.getLastRow() + 1, 1, 1, CAB_CHAMADAS.length)
    .setValues([["'" + data, alvo.t, professor, "'" + hora]]);
  return responder_({ ok: true, ja_finalizada: false, professor: professor, hora: hora });
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

// Valor de célula de data -> "dd/MM/yyyy" (a célula pode vir como texto ou como Date).
function dataTexto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(v).trim();
}

function horaTexto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm:ss');
  return String(v).trim();
}

function dataValida_(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''));
}

// Todas as abas existem e Presenças já está no formato novo? (Se não, garantirAbas_ resolve.)
function abasProntas_() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const nomes = [ABA_ALUNOS, ABA_PROFESSORES, ABA_PRESENCAS, ABA_CHAMADAS];
  if (nomes.some(n => !planilha.getSheetByName(n))) return false;
  const pres = planilha.getSheetByName(ABA_PRESENCAS);
  return String(pres.getRange(1, 1, 1, Math.min(9, pres.getMaxColumns())).getValues()[0]).indexOf('Código') < 0;
}

function formatarData_(iso) {
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
