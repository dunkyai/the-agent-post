(function () {
  var form = document.getElementById("chatForm");
  var input = document.getElementById("chatInput");
  var messages = document.getElementById("chatMessages");
  var errorEl = document.getElementById("chatError");
  var sendBtn = document.getElementById("chatSend");
  var config = window.__chatConfig || {};
  var agentName = config.agentName || "Agent";
  var userName = config.userName || "You";

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
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
          if (!text) throw new Error("Empty response from server — the request may have timed out. Try again.");
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
