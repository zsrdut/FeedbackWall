(function () {
  'use strict';

  // 与后端 MAX_NICKNAME_LENGTH / MAX_CONTENT_LENGTH 默认值保持一致
  var MAX_NICKNAME = 30;
  var MAX_CONTENT = 200;

  var state = {
    submitting: false,
    toastTimer: null
  };

  var el = {
    form: document.getElementById('message-form'),
    nickname: document.getElementById('nickname'),
    content: document.getElementById('content'),
    submit: document.getElementById('submit'),
    nicknameError: document.getElementById('nickname-error'),
    contentError: document.getElementById('content-error'),
    counter: document.getElementById('counter'),
    formError: document.getElementById('form-error'),
    toast: document.getElementById('toast'),
    list: document.getElementById('list'),
    count: document.getElementById('count')
  };

  function codePointLength(value) {
    return Array.from(value).length;
  }

  function formatTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso || '');
    function pad(value) { return value < 10 ? '0' + value : '' + value; }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function showToast(kind, text, autoHide) {
    window.clearTimeout(state.toastTimer);
    el.toast.className = 'toast ' + kind + ' show';
    el.toast.textContent = text;
    if (autoHide) {
      state.toastTimer = window.setTimeout(function () {
        el.toast.className = 'toast';
      }, 2000);
    }
  }

  function hideToast() {
    window.clearTimeout(state.toastTimer);
    el.toast.className = 'toast';
    el.toast.textContent = '';
  }

  function setFieldError(input, node, message) {
    node.textContent = message || '';
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  function setFormError(message) {
    el.formError.textContent = message || '';
  }

  function updateCounter() {
    var length = codePointLength(el.content.value);
    el.counter.textContent = length + '/' + MAX_CONTENT;
    el.counter.classList.toggle('warn', length > MAX_CONTENT);
  }

  function validate() {
    var nickname = el.nickname.value.trim();
    var content = el.content.value.trim();
    var firstInvalid = null;

    setFieldError(el.nickname, el.nicknameError, '');
    setFieldError(el.content, el.contentError, '');

    if (!nickname) {
      setFieldError(el.nickname, el.nicknameError, '请输入昵称');
      firstInvalid = el.nickname;
    } else if (codePointLength(nickname) > MAX_NICKNAME) {
      setFieldError(el.nickname, el.nicknameError, '昵称最多 ' + MAX_NICKNAME + ' 字');
      firstInvalid = el.nickname;
    }

    if (!content) {
      setFieldError(el.content, el.contentError, '请输入留言内容');
      firstInvalid = firstInvalid || el.content;
    } else if (codePointLength(content) > MAX_CONTENT) {
      setFieldError(el.content, el.contentError, '留言内容最多 ' + MAX_CONTENT + ' 字');
      firstInvalid = firstInvalid || el.content;
    }

    if (firstInvalid) firstInvalid.focus();
    return firstInvalid ? null : { nickname: nickname, content: content };
  }

  function setSubmitting(on) {
    state.submitting = on;
    el.submit.disabled = on;
    el.submit.setAttribute('aria-busy', on ? 'true' : 'false');

    if (on) {
      el.submit.textContent = '';
      var spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      el.submit.appendChild(spinner);
      el.submit.appendChild(document.createTextNode('提交中…'));
    } else {
      el.submit.textContent = '提交留言';
    }
  }

  function renderLoading() {
    el.list.textContent = '';
    el.count.textContent = '';
    for (var i = 0; i < 2; i += 1) {
      var skeleton = document.createElement('div');
      skeleton.className = 'skeleton';
      el.list.appendChild(skeleton);
    }
  }

  function renderEmpty() {
    var box = document.createElement('div');
    box.className = 'card state';

    var icon = document.createElement('span');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '💬';

    var text = document.createElement('div');
    text.textContent = '还没有留言，来写下第一条吧～';

    box.appendChild(icon);
    box.appendChild(text);
    el.list.appendChild(box);
  }

  function renderError(message) {
    var box = document.createElement('div');
    box.className = 'card state';
    box.setAttribute('role', 'alert');

    var text = document.createElement('div');
    text.textContent = message;

    var retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试';
    retry.addEventListener('click', function () {
      loadMessages();
    });

    box.appendChild(text);
    box.appendChild(retry);
    el.list.appendChild(box);
  }

  function renderMessages(messages) {
    el.list.textContent = '';
    el.count.textContent = messages.length ? messages.length + ' 条' : '';

    if (!messages.length) {
      renderEmpty();
      return;
    }

    messages.forEach(function (message, index) {
      var card = document.createElement('article');
      card.className = 'card msg' + (index === 0 && message.__fresh ? ' new' : '');

      var top = document.createElement('div');
      top.className = 'msg-top';

      var avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = Array.from(message.nickname || '?')[0] || '?';

      var nickname = document.createElement('span');
      nickname.className = 'nick';
      nickname.textContent = message.nickname;

      var time = document.createElement('time');
      time.className = 'time';
      time.dateTime = message.createdAt || '';
      time.textContent = formatTime(message.createdAt);

      var content = document.createElement('p');
      content.className = 'content';
      content.textContent = message.content;

      top.appendChild(avatar);
      top.appendChild(nickname);
      top.appendChild(time);
      card.appendChild(top);
      card.appendChild(content);
      el.list.appendChild(card);
    });
  }

  function loadMessages() {
    renderLoading();

    return fetch('/api/messages', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var messages = data && Array.isArray(data.messages) ? data.messages : [];
        renderMessages(messages);
      })
      .catch(function () {
        el.list.textContent = '';
        el.count.textContent = '';
        renderError('留言加载失败，请重试');
      });
  }

  function readErrorMessage(response) {
    return response
      .json()
      .then(function (data) {
        if (data && data.error && data.error.message) return data.error.message;
        return '提交失败（HTTP ' + response.status + '）';
      })
      .catch(function () {
        return '提交失败（HTTP ' + response.status + '）';
      });
  }

  function onSubmit(event) {
    event.preventDefault();
    if (state.submitting) return;

    hideToast();
    setFormError('');

    var value = validate();
    if (!value) return;

    setSubmitting(true);

    fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(value)
    })
      .then(function (response) {
        if (!response.ok) {
          return readErrorMessage(response).then(function (message) {
            throw new Error(message);
          });
        }
        return response.json();
      })
      .then(function () {
        el.nickname.value = '';
        el.content.value = '';
        setFieldError(el.nickname, el.nicknameError, '');
        setFieldError(el.content, el.contentError, '');
        updateCounter();
        showToast('ok', '留言成功', true);
        return loadMessages();
      })
      .catch(function (error) {
        setFormError('提交失败：' + (error && error.message ? error.message : '网络异常，请稍后重试'));
      })
      .then(function () {
        setSubmitting(false);
      });
  }

  el.form.addEventListener('submit', onSubmit);

  el.content.addEventListener('input', function () {
    updateCounter();
    if (el.contentError.textContent) setFieldError(el.content, el.contentError, '');
  });

  el.nickname.addEventListener('input', function () {
    if (el.nicknameError.textContent) setFieldError(el.nickname, el.nicknameError, '');
  });

  loadMessages();
})();
