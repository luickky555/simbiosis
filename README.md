# SIMBIOSIS LITE

![Version](https://img.shields.io/badge/version-0.4.6-2f6b3f?style=for-the-badge)
![PWA](https://img.shields.io/badge/PWA-offline%20first-1f7a3d?style=for-the-badge)
![Stack](https://img.shields.io/badge/PHP%20%7C%20JS%20%7C%20MySQL-ffffff?style=for-the-badge)
![Focus](https://img.shields.io/badge/Agro-familiar-7a5c2e?style=for-the-badge)
![AI](https://img.shields.io/badge/IA-BlackboxAI-black?style=for-the-badge)

> **Uma plataforma offline-first para agricultura familiar, feita para funcionar no campo mesmo quando a internet falha ou simplesmente não existe.**

---

## Visão geral

O **SIMBIOSIS LITE** é um **Progressive Web App (PWA)** pensado para a rotina rural, onde conectividade instável pode comprometer registro de dados, fotos e acompanhamento das atividades.
A proposta do sistema é simples e poderosa:

* permitir uso **completo sem internet**;
* salvar dados e fotos **localmente no navegador**;
* sincronizar automaticamente quando a conexão voltar;
* manter o foco na **privacidade**, enviando ao servidor apenas os dados essenciais.

O projeto foi desenhado para ser leve, prático e resiliente, com uma experiência parecida com a de um app nativo, mas sem depender de instalação via loja.

Também houve uso de **Inteligência Artificial** durante o desenvolvimento, com apoio da plataforma **Blackbox AI**, que auxiliou na geração, revisão e aceleração de partes do código, além de contribuir com a produtividade técnica do projeto.

---

## Problema que o projeto resolve

Em muitas áreas rurais, o produtor:

* tem sinal fraco ou inexistente;
* perde informações quando o aplicativo depende de conexão;
* abandona ferramentas que travam no campo;
* precisa registrar dados rapidamente, sem burocracia.

O SIMBIOSIS LITE foi criado justamente para esse cenário: **o trabalho não pode parar porque a internet caiu**.

---

## Principais recursos:

### Offline de verdade

O app funciona mesmo sem conexão, mantendo navegação, formulários e registros essenciais ativos.

### Sincronização automática

Os dados entram em uma **fila local** e são enviados quando a internet volta.

### Diário local

Registros ficam salvos no **IndexedDB**, permitindo histórico confiável no celular.

### Fotos salvas no dispositivo

As imagens são tratadas localmente e associadas aos registros.

### Módulos agrícolas

O sistema organiza a experiência em módulos práticos para o dia a dia no campo:

* **Solo** — leitura rápida de pH e sinais visuais;
* **Pragas** — contagem e monitoramento de infestação;
* **Consórcio** — planejamento de cultivo consorciado;
* **Planta Falante** — análise visual da folha para sinais de estresse e possível doença.

### Privacidade por padrão

O servidor recebe apenas os **dados numéricos e metadados necessários**. As imagens permanecem no dispositivo quando possível.

---

## Arquitetura:

O projeto segue uma arquitetura simples, robusta e fácil de manter:

### 1. Camada web/PWA

Interface principal em PHP + JavaScript, com manifesto e service worker para instalação e uso offline.

### 2. Armazenamento local

O navegador guarda:

* cadastro do usuário;
* registros do Diário;
* imagens relacionadas aos registros;
* fila de sincronização;
* metadados de estado do app.

### 3. Sincronização

Quando o app detecta conexão, ele:

* verifica se o usuário está cadastrado no servidor;
* envia a fila pendente em lotes;
* busca alertas da mesma região;
* mantém tudo consistente sem travar a interface.

### 4. Backend

A API em PHP recebe as requisições com `X-Device-Id`, valida os dados e persiste no MySQL/MariaDB.

---

## Tecnologias utilizadas:

### Front-end

* **HTML5 / CSS3 / JavaScript**
* **Bootstrap 5**
* **PWA**
* **Service Worker**
* **Manifest Web App**

### Persistência local

* **IndexedDB**

### Back-end

* **PHP**
* **PDO**
* **MySQL / MariaDB**

### Processamento local de imagem

* rotinas heurísticas em JavaScript para:

  * solo;
  * pragas;
  * estresse hídrico;
  * sinais visuais da planta.

> Observação: aqui não há “IA pesada” em nuvem. O projeto usa **heurísticas locais e análise de imagem no navegador** para manter o sistema leve e offline.

### Suporte com IA

* **Blackbox AI**

Usada como apoio no desenvolvimento para acelerar tarefas técnicas, revisar trechos de código e auxiliar na construção da solução.

---

## Fluxo de funcionamento:

1. O usuário acessa o app.
2. O cadastro é salvo localmente e também pode ser sincronizado com o servidor.
3. O agricultor registra informações no Diário, mesmo sem internet.
4. Cada ação entra na fila local de sincronização.
5. Quando a conexão retorna, o app envia os dados automaticamente.
6. O sistema puxa alertas da mesma região e atualiza o histórico.

---

## Demonstração ideal

Um roteiro simples para apresentar o sistema:

1. cadastrar o usuário;
2. registrar um item no Diário;
3. desligar a internet;
4. repetir o registro offline;
5. ligar a internet novamente;
6. mostrar o indicador de sincronização concluída.

Esse fluxo evidencia o principal diferencial do projeto: **continuidade de uso no campo**.

---

## Estrutura do projeto:

```txt
SIMBIOSIS/
├── inicio.php                 # Entrada principal do app
├── manifesto.webmanifest      # Manifesto PWA
├── trabalhador_servico.js     # Service Worker / cache offline
├── app/
│   ├── css/estilo.css
│   └── js/
│       ├── aplicativo.js      # UI principal e navegação
│       ├── sincronizacao.js   # Fila e sincronização automática
│       ├── lib/
│       │   ├── banco_local.js  # IndexedDB
│       │   ├── cliente_api.js  # Cliente HTTP da API
│       │   ├── dispositivo.js  # Identificação do dispositivo
│       │   ├── imagem.js       # Leitura e tratamento de imagens
│       │   └── utilitarios.js  # Helpers gerais
│       └── cv/
│           ├── solo.js         # Análise local de solo
│           ├── pragas.js       # Contagem de pragas
│           └── planta.js       # Análise visual da planta
├── api/
│   ├── inicio.php              # Roteador da API
│   └── lib/                    # Camada de banco e repositorios
└── db/
    └── banco.sql               # Esquema do banco de dados
```

---

## Banco de dados

O esquema principal inclui estas tabelas:

### `users`

Armazena o cadastro do produtor, comunidade, culturas e identificador da região.

### `records`

Guarda os registros sincronizados do Diário com vínculo ao usuário.

### `alerts`

Armazena avisos comunitários compartilhados por região.

### `plant_cases`

Guarda casos numéricos derivados das análises da planta para comparação futura.

---

## API

A API aceita rotas em formato REST-like e trabalha com `device_id` via cabeçalho `X-Device-Id`.

### Rotas principais

#### `GET /ping`

Verificação de saúde do servidor.

#### `POST /users/register`

Cria ou atualiza o cadastro do usuário.

#### `GET /users/me`

Retorna o usuário associado ao dispositivo atual.

#### `POST /users/claim_code`

Permite resgatar um cadastro por código de produtor.

#### `GET /records/recent`

Lista registros recentes do Diário.

#### `POST /alerts/publish`

Publica um alerta na região do usuário.

#### `GET /alerts/pull`

Busca alertas recentes da mesma região.

#### `POST /plant/case`

Salva um caso de planta baseado em dados numéricos.

#### `POST /plant/compare`

Compara um novo caso com casos anteriores da região.

#### `POST /plant/feedback`

Salva feedback sobre um caso analisado.

#### `POST /sync/push`

Recebe a fila local e aplica as mutações no servidor.

---

## Instalação local

### Requisitos

* PHP com suporte a `PDO`
* MySQL ou MariaDB
* Servidor web com suporte a rewrite (Apache recomendado)
* Navegador moderno com suporte a PWA e IndexedDB

### Passo 1: importar o banco

Execute o arquivo:

```sql
db/banco.sql
```

Isso cria o banco `simbiosis_lite` com as tabelas necessárias.

### Passo 2: configurar as variáveis de ambiente

A API lê as credenciais por meio de variáveis `RQ_DB_*`:

```env
RQ_DB_HOST=127.0.0.1
RQ_DB_PORT=3306
RQ_DB_NAME=simbiosis_lite
RQ_DB_USER=root
RQ_DB_PASS=sua_senha
RQ_DB_CHARSET=utf8mb4
```

### Passo 3: publicar o projeto no servidor

Coloque a pasta `SIMBIOSIS/` no diretório público do servidor web.

Se estiver usando Apache, o arquivo `.htaccess` já ajuda com:

* `inicio.php` como entrada padrão;
* redirecionamento de `/api/...` para `api/inicio.php`.

### Passo 4: abrir o app

Acesse a raiz do projeto no navegador e instale como app quando o sistema oferecer a opção.

---

## Como o modo offline funciona

O aplicativo usa três mecanismos combinados:

### Service Worker

Mantém arquivos essenciais em cache, permitindo abrir a interface sem internet.

### IndexedDB

Guarda o estado local do app, o cadastro, o Diário, as imagens e a outbox.

### Fila de sincronização

Registra cada operação pendente para envio posterior.

Essa combinação evita perda de dados e permite continuidade real de uso.

---

## Segurança e privacidade

O projeto adota algumas decisões importantes:

* identificação por `X-Device-Id`;
* dados sensíveis minimizados na sincronização;
* imagens processadas no dispositivo;
* armazenamento local para manter a operação offline;
* comunicação padronizada por JSON.

Essas escolhas reduzem dependência da rede e ajudam a manter o sistema mais leve.

---

## Diferenciais técnicos

* funcionamento offline completo;
* arquitetura simples de entender e manter;
* sincronização resiliente;
* separação clara entre front-end, fila local e API;
* análise visual local sem depender de serviços externos;
* foco em áreas onde conexão não é garantida.

---

## Roadmap sugerido

* melhorias na usabilidade mobile;
* indicadores mais visuais de sincronização;
* exportação de relatórios;
* refinamento das heurísticas de análise de imagem;
* autenticação adicional para múltiplos dispositivos;
* suporte a mais culturas e cenários agrícolas.

---

## Créditos

Projeto voltado para agricultura familiar, com foco em produtividade no campo, resistência à falta de internet e preservação de dados locais.

Desenvolvimento com apoio de **IA via Blackbox AI** para acelerar e organizar partes do fluxo técnico do projeto.

---

<div align="center">

**SIMBIOSIS LITE** — tecnologia pensada para o campo, com funcionamento real mesmo offline.

</div> 
