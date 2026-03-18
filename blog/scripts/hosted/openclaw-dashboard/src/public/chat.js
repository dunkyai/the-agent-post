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
    bubble.textContent = content;

    div.appendChild(avatar);
    div.appendChild(bubble);
    messages.appendChild(div);
    scrollToBottom();
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
