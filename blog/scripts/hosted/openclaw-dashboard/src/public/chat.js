(function () {
  var form = document.getElementById("chatForm");
  var input = document.getElementById("chatInput");
  var messages = document.getElementById("chatMessages");
  var errorEl = document.getElementById("chatError");
  var sendBtn = document.getElementById("chatSend");
  var config = window.__chatConfig || {};
  var agentName = config.agentName || "Agent";
  var userName = config.userName || "You";
  var messageCount = messages.querySelectorAll(".chat-message").length;
  var memorySaved = false;

  // Minimal markdown-to-HTML renderer
  function renderMarkdown(src) {
    // Escape HTML entities first (XSS prevention)
    var html = src
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    // Fenced code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre><code>' + code.replace(/\n$/, '') + '</code></pre>';
    });

    // Inline code (` ... `)
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Images ![alt](src)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Bold **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic *text*
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // Split into paragraphs by double newlines
    var blocks = html.split(/\n{2,}/);
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i].trim();
      if (!block) continue;

      // Already wrapped in block-level tag
      if (/^<(pre|img|ul|ol)/.test(block)) {
        out.push(block);
        continue;
      }

      // Unordered list block
      if (/^[-*] /.test(block)) {
        var items = block.split(/\n/).map(function (line) {
          return '<li>' + line.replace(/^[-*] /, '') + '</li>';
        }).join('');
        out.push('<ul>' + items + '</ul>');
        continue;
      }

      // Ordered list block
      if (/^\d+\. /.test(block)) {
        var items = block.split(/\n/).map(function (line) {
          return '<li>' + line.replace(/^\d+\. /, '') + '</li>';
        }).join('');
        out.push('<ol>' + items + '</ol>');
        continue;
      }

      // Regular paragraph — convert single newlines to <br>
      out.push('<p>' + block.replace(/\n/g, '<br>') + '</p>');
    }

    return out.join('');
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function maybeShowMemoryLink() {
    if (memorySaved || messages.querySelector(".memory-prompt")) return;
    var total = messages.querySelectorAll(".chat-message").length;
    if (total < 6) return;
    var link = document.createElement("div");
    link.className = "memory-prompt";
    link.style.cssText = "text-align: center; margin: 12px 0; font-size: 13px;";
    link.innerHTML = '<a href="#" style="color: var(--accent); text-decoration: underline;">Save to memory so I will remember in the future</a>';
    link.querySelector("a").addEventListener("click", function (e) {
      e.preventDefault();
      if (memorySaved) return;
      memorySaved = true;
      link.innerHTML = '<span style="color: var(--text-secondary);">Saving...</span>';
      fetch("/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Please review our conversation and save the important details, decisions, and preferences to your memory so you remember them in the future." }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          link.innerHTML = '<span style="color: var(--text-secondary);">Saved to memory</span>';
          addMessage("assistant", data.content);
        })
        .catch(function () {
          link.innerHTML = '<span style="color: var(--danger);">Failed to save</span>';
          memorySaved = false;
        });
    });
    messages.appendChild(link);
    scrollToBottom();
  }

  function addMessage(role, content) {
    // Remove the empty state message if present
    var emptyMsg = messages.querySelector("p");
    if (emptyMsg) emptyMsg.remove();

    var div = document.createElement("div");
    div.className = "chat-message " + role;

    var avatar = document.createElement("div");
    avatar.className = "avatar";
    var name = role === "user" ? userName : agentName;
    avatar.textContent = name.charAt(0);
    avatar.title = name;

    var bubble = document.createElement("div");
    bubble.className = "bubble";
    if (role === "user") {
      bubble.textContent = content;
    } else {
      bubble.innerHTML = renderMarkdown(content);
    }

    div.appendChild(avatar);
    div.appendChild(bubble);
    messages.appendChild(div);
    scrollToBottom();
  }

  // Re-render server-rendered assistant bubbles with markdown on load
  var existingBubbles = messages.querySelectorAll(".chat-message.assistant .bubble");
  for (var i = 0; i < existingBubbles.length; i++) {
    var raw = existingBubbles[i].textContent || "";
    existingBubbles[i].innerHTML = renderMarkdown(raw);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;

    addMessage("user", text);
    input.value = "";
    input.disabled = true;
    sendBtn.disabled = true;
    sendBtn.textContent = "...";
    errorEl.textContent = "";

    // Show thinking indicator
    var thinking = document.createElement("div");
    thinking.className = "chat-message assistant thinking-indicator";
    thinking.innerHTML = '<div class="avatar" title="' + agentName + '">' + agentName.charAt(0) + '</div><div class="bubble thinking-bubble"><span class="spinner"></span> Thinking...</div>';
    messages.appendChild(thinking);
    scrollToBottom();

    fetch("/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    })
      .then(function (res) {
        return res.text().then(function (text) {
          if (!text) throw new Error("Oops — I can't seem to connect right now. Do you want me to try again?");
          try {
            var data = JSON.parse(text);
          } catch (e) {
            throw new Error("Invalid response from server");
          }
          if (!res.ok) throw new Error(data.error || "Request failed");
          return data;
        });
      })
      .then(function (data) {
        var t = messages.querySelector(".thinking-indicator");
        if (t) t.remove();
        addMessage("assistant", data.content);
        maybeShowMemoryLink();
      })
      .catch(function (err) {
        var t = messages.querySelector(".thinking-indicator");
        if (t) t.remove();
        errorEl.textContent = err.message;
      })
      .finally(function () {
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
        input.focus();
      });
  });

  scrollToBottom();
})();
