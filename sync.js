
/*
 * Bela Modas | Sincronização do Catálogo
 * Comunicação com o Google Apps Script.
 */

(() => {
  'use strict';

  const CONFIG = {
    // Substituiremos pela URL /exec após a implantação.
    API_URL: 'COLE_AQUI_A_URL_DO_APPS_SCRIPT',

    TIMEOUT: 30000,
    MAX_FOTO_BYTES: 5 * 1024 * 1024
  };

  let tokenAdmin = null;
  let sessaoValidaAte = 0;

  function verificarConfiguracao() {
    if (!CONFIG.API_URL.startsWith('https://')) {
      throw new Error('A URL de conexão ainda não foi configurada.');
    }
  }

  function gerarNonce() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);

    return Array.from(bytes)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function requisicaoPost(dados) {
    verificarConfiguracao();

    return new Promise((resolve, reject) => {
      const nonce = gerarNonce();
      const iframe = document.createElement('iframe');
      const formulario = document.createElement('form');
      const nomeIframe = 'bela_sync_' + nonce;

      iframe.name = nomeIframe;
      iframe.style.display = 'none';
      iframe.setAttribute('aria-hidden', 'true');

      formulario.method = 'POST';
      formulario.action = CONFIG.API_URL;
      formulario.target = nomeIframe;
      formulario.style.display = 'none';

      const payload = { ...dados, nonce };

      Object.entries(payload).forEach(([chave, valor]) => {
        const campo = document.createElement('input');
        campo.type = 'hidden';
        campo.name = chave;
        campo.value = typeof valor === 'string'
          ? valor
          : JSON.stringify(valor);

        formulario.appendChild(campo);
      });

      let finalizado = false;

      function limpar() {
        window.removeEventListener('message', receberMensagem);
        formulario.remove();
        iframe.remove();
      }

      function concluir(erro, resultado) {
        if (finalizado) return;
        finalizado = true;
        clearTimeout(temporizador);
        limpar();

        if (erro) reject(erro);
        else resolve(resultado);
      }

      function receberMensagem(evento) {
        if (evento.source !== iframe.contentWindow) return;

        // A resposta deve vir da página intermediária do Apps Script.
        if (!/\.googleusercontent\.com$/.test(
          new URL(evento.origin).hostname
        )) return;

        const resposta = evento.data;

        if (!resposta || resposta.nonce !== nonce) return;

        if (!resposta.sucesso) {
          concluir(new Error(resposta.erro || 'Falha na operação.'));
          return;
        }

        concluir(null, resposta.resultado);
      }

      window.addEventListener('message', receberMensagem);

      const temporizador = setTimeout(() => {
        concluir(new Error('Tempo de conexão esgotado.'));
      }, CONFIG.TIMEOUT);

      document.body.appendChild(iframe);
      document.body.appendChild(formulario);
      formulario.submit();
    });
  }

  function buscarProdutos() {
    verificarConfiguracao();

    return new Promise((resolve, reject) => {
      const callback = '__belaProdutos_' + gerarNonce();
      const script = document.createElement('script');
      const temporizador = setTimeout(() => {
        finalizar(new Error('Não foi possível carregar os produtos.'));
      }, CONFIG.TIMEOUT);

      function finalizar(erro, dados) {
        clearTimeout(temporizador);
        delete window[callback];
        script.remove();

        if (erro) reject(erro);
        else if (!dados || !dados.sucesso) {
          reject(new Error(dados?.erro || 'Resposta inválida.'));
        } else {
          resolve(dados.produtos || []);
        }
      }

      window[callback] = dados => finalizar(null, dados);

      script.onerror = () => {
        finalizar(new Error('Falha ao acessar o catálogo.'));
      };

      script.src = CONFIG.API_URL +
        '?callback=' + encodeURIComponent(callback);

      document.head.appendChild(script);
    });
  }

  async function entrar(senha) {
    if (!senha || senha.length < 12) {
      throw new Error('Informe sua senha administrativa.');
    }

    const resultado = await requisicaoPost({
      acao: 'login',
      senha
    });

    if (!resultado || !resultado.token) {
      throw new Error('Não foi possível iniciar a sessão.');
    }

    tokenAdmin = resultado.token;

    const duracao = Number(resultado.validadeSegundos || 0);
    sessaoValidaAte = Date.now() + duracao * 1000;

    return { conectado: true };
  }

  function exigirSessao() {
    if (!tokenAdmin || Date.now() >= sessaoValidaAte) {
      tokenAdmin = null;
      sessaoValidaAte = 0;
      throw new Error('Sua sessão expirou. Entre novamente.');
    }
  }

  function sair() {
    tokenAdmin = null;
    sessaoValidaAte = 0;
  }

  async function salvarProduto(produto) {
    exigirSessao();

    return requisicaoPost({
      acao: 'salvar',
      token: tokenAdmin,
      produto
    });
  }

  async function excluirProduto(codigo) {
    exigirSessao();

    return requisicaoPost({
      acao: 'excluir',
      token: tokenAdmin,
      codigo
    });
  }

  function arquivoParaBase64(arquivo) {
    return new Promise((resolve, reject) => {
      if (!arquivo || !arquivo.type.startsWith('image/')) {
        reject(new Error('Selecione um arquivo de imagem válido.'));
        return;
      }

      if (arquivo.size > CONFIG.MAX_FOTO_BYTES) {
        reject(new Error('A foto deve ter no máximo 5 MB.'));
        return;
      }

      const leitor = new FileReader();

      leitor.onload = () => {
        const conteudo = String(leitor.result);
        resolve(conteudo.split(',')[1]);
      };

      leitor.onerror = () => {
        reject(new Error('Não foi possível ler a foto.'));
      };

      leitor.readAsDataURL(arquivo);
    });
  }

  async function enviarFoto(codigo, arquivo) {
    exigirSessao();

    const base64 = await arquivoParaBase64(arquivo);

    return requisicaoPost({
      acao: 'foto',
      token: tokenAdmin,
      codigo,
      nomeArquivo: arquivo.name,
      tipo: arquivo.type,
      base64
    });
  }

  window.BelaSync = Object.freeze({
    buscarProdutos,
    entrar,
    sair,
    salvarProduto,
    excluirProduto,
    enviarFoto
  });
})();
