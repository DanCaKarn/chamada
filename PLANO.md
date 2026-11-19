# Plano de construção: Chamada QR v3

Plano saído do brainstorm de 19/11/2026. Cada etapa é pequena e pode ser testada sozinha.
Faça **uma etapa por vez**, na ordem: cada uma depende das anteriores.

## Regras para todas as etapas

- **LGPD:** nenhum nome de aluno no código, no GitHub ou gravado no celular. Nomes só na planilha;
  no app, ficam **só na memória** enquanto ele está aberto.
- **Segredos fora do código:** o endereço `/exec` e as chaves dos professores nunca vão para arquivos do repositório.
- **Planilha atual = planilha de testes:** toda a construção usa a planilha que já existe.
  Quando o app estiver pronto, uma **planilha oficial nova** é criada do zero (Etapa 10).
- **Cache:** ao mudar `index.html` (ou qualquer arquivo do app), aumentar a versão do `CACHE` em `sw.js`.
- **Ao fim de cada etapa:** testar, depois pedir ao Claude Code *"faça o commit e o push desta etapa"*
  e marcar a etapa como feita aqui (`[x]`).

## Como o app e a planilha conversam (contrato)

Toda conversa é um **POST** para o `/exec` com um JSON que sempre leva a `chave` do professor
(nunca na URL, para não aparecer em históricos). Sem chave válida, a planilha responde `{"ok":false,"erro":"chave"}`.

| `acao` | O app manda | A planilha responde |
|---|---|---|
| `teste` | `chave` | `ok`, nome da planilha, **nome do professor** |
| `enviar` | `ops`: `add` `{id, matricula, data, hora, forma}` / `del` `{id}` | `ok`, gravadas, apagadas |
| `alunos` | — | lista `[{m: matrícula, n: nome, t: turma, s: situação}]` |
| `status` | `data` | por turma: total, presentes, ausentes (com nomes), finalizada (hora e professor) |
| `finalizar` | `turma`, `data` | `ok` |

- `forma`: `"QR"` ou `"Digitado"`.
- A **turma** de cada presença é descoberta pela planilha (aba Alunos) no momento em que ela recebe
  a leitura, e fica gravada na linha. Assim, um remanejamento futuro não altera presenças antigas.
- **Duplicata:** mesma **data + matrícula** → ignora a nova leitura; vale a primeira.

## Abas da planilha

| Aba | Colunas | Quem preenche |
|---|---|---|
| **Alunos** | Nome · Matrícula · Turma · Situação (em branco = ativo, ou "Transferido") | você (importação) |
| **Professores** | Nome · Chave · Ativo | menu da planilha gera a chave |
| **Presenças** | ID (oculta) · Data · Hora · Matrícula · Nome · Turma · Professor · Forma · Recebido em | o script |
| **Chamadas** | Data · Turma · Professor · Finalizada às | o script |

---

## Etapas

### [x] Etapa 0: Preparar o terreno
**Você faz:** colocar este arquivo na pasta do projeto como `PLANO.md`.

**Pedido para o Claude Code:**
> Leia o PLANO.md. Atualize o CLAUDE.md: o QR Code agora terá só a matrícula, a planilha terá as abas
> Alunos, Professores, Presenças e Chamadas, e o contrato app↔planilha está no PLANO.md. Não mude código ainda.

**Pronto quando:** CLAUDE.md atualizado e commit feito.

---

### [ ] Etapa 1: Planilha: abas novas e chave por professor (só o script)
**Pedido para o Claude Code:**
> Etapa 1 do PLANO.md, só no planilha-chamada.gs:
> - Criar (se não existirem) as abas Alunos, Professores e Chamadas com os cabeçalhos do plano.
>   Na coluna Situação da aba Alunos, uma lista suspensa com "Transferido".
> - Menu na planilha "Chamada QR > Novo professor": pede o nome e gera uma chave aleatória (12+ caracteres)
>   na aba Professores, com Ativo = SIM.
> - Toda requisição exige `chave` válida e ativa; responder `{"ok":false,"erro":"chave"}` se não.
> - Ações `teste` e `enviar` conforme o contrato. Em `enviar`: buscar turma e nome na aba Alunos pela matrícula,
>   gravar Professor (da chave) e Forma; duplicata por data + matrícula; matrícula não cadastrada é gravada
>   mesmo assim, com a linha destacada em amarelo e Turma = "NÃO CADASTRADA".
> - Manter a leitura só das linhas recentes (desempenho).
> Explique o plano antes de aplicar.

**Você faz:** colar o script na planilha atual (a de testes), nova versão da implantação, cadastrar 3 ou 4 alunos
fictícios na aba Alunos e criar um professor pelo menu.

**Como testar (terminal, com `curl`):** enviar com chave certa (grava, com nome, turma, professor e forma);
com chave errada (erro); a mesma matrícula 2 vezes (a 2ª é ignorada); uma matrícula inexistente (linha amarela).

---

### [ ] Etapa 2: Planilha: alunos, status e finalizar (só o script)
**Pedido para o Claude Code:**
> Etapa 2 do PLANO.md: no script, implementar as ações `alunos`, `status` e `finalizar` conforme o contrato.
> Em `status`, ausentes = alunos ativos da turma sem presença na data; transferidos não contam.
> Uma turma sem nenhuma presença na data vem como "sem chamada" (sem lista de ausentes).
> `finalizar` grava data, turma, professor e hora na aba Chamadas.

**Como testar:** `curl` em cada ação; conferir que os transferidos não aparecem como ausentes e que uma turma
sem leituras vem como "sem chamada".

---

### [ ] Etapa 3: App: configuração por QR Code e chave
**Pedido para o Claude Code:**
> Etapa 3 do PLANO.md:
> - Criar a página configurar.html (para o coordenador): campos para o /exec e a chave → mostra na tela um QR Code
>   com `CHAMADAQR1|<exec>|<chave>`. Tudo gerado no navegador (biblioteca de QR por CDN), sem enviar nada a lugar nenhum.
> - No app, em Ajustes: botão "Ler QR de configuração", que usa a câmera, reconhece o prefixo CHAMADAQR1,
>   salva o endereço e a chave e chama `teste`, mostrando "Configurado para: <professor>".
> - Manter a opção de colar o endereço e a chave à mão.
> - Todas as chamadas do app passam a mandar a chave, usando a ação `enviar`.

**Como testar:** gerar o QR no PC e ler com o app (no PC e no iPhone); ver o nome do professor nos Ajustes;
uma leitura chega na planilha com a coluna Professor preenchida.

---

### [ ] Etapa 4: App: matrícula e nomes na leitura
**Pedido para o Claude Code:**
> Etapa 4 do PLANO.md:
> - Ao tocar em "Iniciar leitura", baixar a lista com a ação `alunos` e guardar SÓ EM MEMÓRIA (nunca em
>   localStorage). Sem internet, seguir sem nomes (mostrando só a matrícula).
> - O conteúdo do QR Code passa a ser a matrícula. Enviar `{id, matricula, data, hora, forma:"QR"}`.
> - Cartão de confirmação: nome e turma (da lista em memória). Aviso para aluno "Transferido".
>   "Já registrado às HH:MM" se a matrícula já tiver sido lida hoje neste celular.
> - Lista do dia guardada no celular só com matrícula, turma e hora (sem nome); na tela, o nome vem da memória.

**Como testar:** gerar QR Codes de teste com as matrículas fictícias; conferir o nome no cartão; testar um transferido;
desligar a internet antes de abrir e ver que funciona sem nomes.

---

### [ ] Etapa 5: App: Digitar com matrícula e confirmação
**Pedido para o Claude Code:**
> Etapa 5 do PLANO.md: o painel Digitar passa a pedir só a matrícula (teclado numérico: inputmode="numeric").
> Ao buscar, abre o MESMO cartão de confirmação da câmera (nome e turma). Avisos: "Matrícula não encontrada"
> (não registra, se a lista de nomes estiver carregada), transferido e já registrado hoje. Enviar com forma:"Digitado".

**Como testar:** digitar uma matrícula válida, uma inexistente, a de um transferido e uma já registrada.
Na planilha, a coluna Forma deve vir "Digitado".

---

### [ ] Etapa 6: App: tela por turma, status e Finalizar chamada
**Pedido para o Claude Code:**
> Etapa 6 do PLANO.md: o painel Lista passa a mostrar contadores por turma ("1M01-MCN · 32 de 35"), com status
> 🟢 finalizada / 🟡 em andamento / ⚪ sem chamada, usando a ação `status` (dados de todos os celulares).
> Tocar na turma abre os alunos com hora e o botão Tirar (que continua apagando da planilha).
> Botão "Finalizar chamada" na turma: mostra "Faltam N: nomes… Finalizar mesmo assim?" e chama `finalizar`.
> Remover os botões Baixar CSV e Copiar CSV.

**Como testar:** dois navegadores (PC e iPhone) lendo alunos da mesma turma → os contadores somam os dois;
finalizar → fica 🟢 nos dois.

---

### [ ] Etapa 7: App: Compartilhar presentes e ausentes
**Pedido para o Claude Code:**
> Etapa 7 do PLANO.md: na Lista, botões "Compartilhar presentes" e "Compartilhar ausentes". Perguntar
> "Só esta turma" ou "Todas as turmas". Montar o texto (formato de mensagem de WhatsApp, com nomes, hora do
> momento e status 🟢🟡⚪ de cada turma; turmas sem chamada só aparecem como "sem chamada") e abrir a janela
> de compartilhar do sistema (navigator.share). Se falhar, copiar para a área de transferência.

**Como testar:** compartilhar no iPhone para você mesmo no WhatsApp; conferir o texto das duas mensagens.

---

### [ ] Etapa 8: App: Encerrar e encerrar automático
**Pedido para o Claude Code:**
> Etapa 8 do PLANO.md: botão "Encerrar" no topo, perto da engrenagem: desliga a câmera, tenta enviar a fila
> (avisando se sobrar algo), apaga a lista de nomes da memória e mostra "Chamada encerrada ✅ Pode fechar o app."
> Nos Ajustes: "Encerrar sozinho depois de" 2 / 5 / 10 / 30 min minimizado (padrão 5, sem opção "Nunca").
> Implementar guardando o horário em que o app foi para segundo plano (visibilitychange) e comparando na volta.

**Como testar:** encerrar e ver que os nomes somem (reabrir baixa de novo); com 2 min, minimizar por 3 min e voltar.

---

### [ ] Etapa 9: App: limpeza na virada do dia e aviso
**Pedido para o Claude Code:**
> Etapa 9 do PLANO.md: ao abrir o app (e na virada do dia com ele aberto), apagar do celular as leituras de dias
> anteriores já enviadas. As não enviadas continuam na fila, e aparece o aviso
> "N leituras de dias anteriores ainda não chegaram na planilha. Conecte à internet."

**Como testar:** mudar a data do PC para o dia seguinte, com uma leitura presa na fila (sem internet), e abrir o app.

---

### [ ] Etapa 10: Criar a planilha oficial
**Você faz:**
1. Criar uma **planilha nova**, do zero (a atual continua como planilha de testes).
2. Extensões → Apps Script: colar o script final, salvar, conferir o fuso horário e **implantar como App da Web**
   (Executar como: Eu · Quem pode acessar: Qualquer pessoa). Guardar o **novo `/exec`**.
3. Importar a aba Alunos de verdade e criar os professores pelo menu.
4. Gerar o QR de configuração de cada professor (configurar.html, com o novo `/exec`) e configurar os celulares.
5. Imprimir as carteirinhas com o QR Code da matrícula.
6. Fazer um piloto com **uma turma** antes de liberar para todas.

---

## 🅿️ Estacionamento (próximas atualizações)
- **Câmera só aceita matrículas cadastradas:** ignorar em silêncio o que não parece matrícula; avisar
  "não cadastrada" se parecer matrícula; sem internet, aceitar (a planilha confere). Falta saber o formato das matrículas.
- **Gerador de carteirinhas** (PDF com QR Code da matrícula, a partir da aba Alunos), feito localmente em Python.
- **Transferidos e remanejados:** revisar a regra fina depois do piloto.

## ❌ Descartado
- Faltas justificadas: o sistema oficial cuida.
- Botões de CSV: substituídos pelo Compartilhar.
