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
    // Clean up malformed nested image markdown before rendering
    // e.g. ![alt](\n![image](url)\n) -> ![image](url)
    src = src.replace(/!\[[^\]]*\]\(\s*\n*!\[([^\]]*)\]\(([^)\s]+)\)\s*\n*\)/g, '![$1]($2)');
    // Remove image tags with empty/whitespace-only URLs
    src = src.replace(/!\[[^\]]*\]\(\s*\)/g, '');

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

    // Images ![alt](src) — match across whitespace in URL
    html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img alt="$1" src="$2">');

    // Links [text](url) — only match if not preceded by !
    html = html.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

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
        .then(function () {
          // Poll until done
          function pollMemory() {
            fetch("/chat/poll").then(function (r) { return r.json(); }).then(function (data) {
              if (data.done) {
                if (data.result) {
                  link.innerHTML = '<span style="color: var(--text-secondary);">Saved to memory</span>';
                  addMessage("assistant", data.result.content);
                } else {
                  link.innerHTML = '<span style="color: var(--danger);">Failed to save</span>';
                  memorySaved = false;
                }
              } else {
                setTimeout(pollMemory, 1000);
              }
            });
          }
          setTimeout(pollMemory, 2000);
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
    thinking.innerHTML = '<div class="avatar" title="' + agentName + '">' + agentName.charAt(0) + '</div><div class="bubble thinking-bubble"><span class="spinner"></span> <span class="thinking-text">Thinking...</span></div>';
    messages.appendChild(thinking);
    scrollToBottom();

    // Submit message
    fetch("/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    })
      .then(function (res) {
        console.log("[post] status:", res.status, "redirected:", res.redirected);
        return res.json();
      })
      .then(function (data) {
        console.log("[post] response:", JSON.stringify(data));
        if (data.error) {
          var t = messages.querySelector(".thinking-indicator");
          if (t) t.remove();
          errorEl.textContent = data.error;
          input.disabled = false;
          sendBtn.disabled = false;
          sendBtn.textContent = "Send";
          input.focus();
          return;
        }
        // Start polling for status updates
        pollForResult();
      })
      .catch(function (err) {
        var t = messages.querySelector(".thinking-indicator");
        if (t) t.remove();
        errorEl.textContent = err.message || "Connection error";
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
        input.focus();
      });
  });

  function pollForResult() {
    fetch("/chat/poll")
      .then(function (res) {
        if (!res.ok) {
          console.error("[poll] HTTP error:", res.status);
          // Auth redirect — page might need refresh
          if (res.status === 302 || res.redirected) {
            errorEl.textContent = "Session expired. Please refresh the page.";
            input.disabled = false;
            sendBtn.disabled = false;
            sendBtn.textContent = "Send";
            return Promise.reject("redirect");
          }
          return res.text().then(function (t) { return { status: "error", error: t, done: true }; });
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        console.log("[poll]", JSON.stringify(data).slice(0, 200));

        if (data.done) {
          var t = messages.querySelector(".thinking-indicator");
          if (t) t.remove();

          if (data.status === "error") {
            errorEl.textContent = data.error || "Something went wrong";
          } else if (data.result) {
            addMessage("assistant", data.result.content);
            maybeShowMemoryLink();
          }

          input.disabled = false;
          sendBtn.disabled = false;
          sendBtn.textContent = "Send";
          input.focus();
          return;
        }

        // Update thinking text with current status
        var thinkingText = messages.querySelector(".thinking-text");
        if (thinkingText && data.status) {
          thinkingText.textContent = data.status;
        }
        scrollToBottom();

        // Poll again in 1 second
        setTimeout(pollForResult, 1000);
      })
      .catch(function (err) {
        if (err === "redirect") return;
        console.error("[poll] error:", err);
        // Network error during poll — retry
        setTimeout(pollForResult, 2000);
      });
  }

  scrollToBottom();
})();
