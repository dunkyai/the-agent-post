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

  // Ordered task queue — results appear in submission order
  var taskQueue = [];

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

    // Images ![alt](src) — match http(s) URLs and data: URIs (base64 screenshots)
    html = html.replace(/!\[([^\]]*)\]\(((?:https?:\/\/|data:)[^)\s]+)\)/g, '<img alt="$1" src="$2">');

    // Links [text](url) — only match if not preceded by !
    html = html.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Bold URLs — handle **https://...** before general bold/URL processing
    // Strips bold markers and auto-links the URL cleanly
    html = html.replace(/\*\*(https?:\/\/[^\s*]+)\*\*/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

    // Bare URLs — auto-link URLs not already inside an href or src attribute
    // Allow underscores in URLs (common in query params, paths, etc.)
    html = html.replace(/(?<!=&quot;|="|src="|href=")(https?:\/\/[^\s<)\]*`]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

    // Bold **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic *text* — but not inside URLs (href/src attributes)
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // Italic _text_ — only match word-boundary underscores, not underscores inside URLs
    html = html.replace(/(?<![\/\w])_([^_]+)_(?![\/\w])/g, '<em>$1</em>');

    // Split into paragraphs by double newlines
    var blocks = html.split(/\n{2,}/);

    // Merge consecutive ordered list blocks into one
    var mergedBlocks = [];
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b].trim();
      if (!blk) continue;
      if (/^\d+\.\s/.test(blk) && mergedBlocks.length > 0 && /^\d+\.\s/.test(mergedBlocks[mergedBlocks.length - 1])) {
        mergedBlocks[mergedBlocks.length - 1] += "\n" + blk;
      } else {
        mergedBlocks.push(blk);
      }
    }
    blocks = mergedBlocks;

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

      // Ordered list block — use start attribute to preserve original numbering
      if (/^\d+\.\s/.test(block)) {
        var lines = block.split(/\n/);
        var startMatch = lines[0].match(/^(\d+)\.\s/);
        var startNum = startMatch ? parseInt(startMatch[1], 10) : 1;
        var items = lines.map(function (line) {
          return '<li>' + line.replace(/^\d+\.\s/, '') + '</li>';
        }).join('');
        out.push('<ol start="' + startNum + '">' + items + '</ol>');
        continue;
      }

      // Headings (# to ######) — if more lines follow, split them out
      var headingMatch = block.match(/^(#{1,6}) (.+)/);
      if (headingMatch) {
        var level = headingMatch[1].length;
        var text = headingMatch[2];
        out.push('<h' + level + '>' + text + '</h' + level + '>');
        // Re-queue remaining lines after the heading for processing
        var remaining = block.substring(block.indexOf('\n') + 1).trim();
        if (remaining && block.indexOf('\n') !== -1) {
          blocks.splice(i + 1, 0, remaining);
        }
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
        body: JSON.stringify({ message: "Please review our conversation and save the important details, decisions, and preferences to your memory so you remember them in the future.", threadId: window.__chatConfig?.threadId || "" }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok || !data.taskId) {
            link.innerHTML = '<span style="color: var(--danger);">Failed to save</span>';
            memorySaved = false;
            return;
          }
          var memTaskId = data.taskId;
          function pollMemory() {
            fetch("/chat/poll?taskId=" + encodeURIComponent(memTaskId)).then(function (r) { return r.json(); }).then(function (d) {
              var t = d.tasks && d.tasks[0];
              if (t && t.done) {
                if (t.result) {
                  link.innerHTML = '<span style="color: var(--text-secondary);">Saved to memory</span>';
                  addMessage("assistant", t.result.content);
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
    // Remove the empty state message if present (direct child only, not <p> inside bubbles)
    var emptyMsg = messages.querySelector(":scope > p");
    if (emptyMsg) emptyMsg.remove();

    var div = document.createElement("div");
    div.className = "chat-message " + role;

    var avatar = document.createElement("div");
    avatar.className = "avatar" + (role === "assistant" ? " agent-avatar" : "");
    var name = role === "user" ? userName : agentName;
    avatar.title = name;
    if (role === "assistant") {
      var img = document.createElement("img");
      img.src = "/mascot.webp";
      img.alt = name;
      avatar.appendChild(img);
    } else {
      avatar.textContent = name.charAt(0);
    }

    var bubble = document.createElement("div");
    bubble.className = "bubble";
    if (role === "user") {
      // Escape HTML but auto-link URLs
      var escaped = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      bubble.innerHTML = escaped;
    } else {
      bubble.innerHTML = renderMarkdown(content);
    }

    div.appendChild(avatar);
    div.appendChild(bubble);
    messages.appendChild(div);
    scrollToBottom();
  }

  function createThinkingIndicator(taskId) {
    var thinking = document.createElement("div");
    thinking.className = "chat-message assistant thinking-indicator";
    thinking.setAttribute("data-task-id", taskId || "pending");
    thinking.innerHTML = '<div class="avatar agent-avatar" title="' + agentName + '"><img src="/mascot.webp" alt="' + agentName + '" /></div><div class="bubble thinking-bubble"><div class="thinking-top"><span class="thinking-dots"><span></span><span></span><span></span></span> <span class="thinking-text">Thinking...</span><button class="cancel-btn" title="Cancel" onclick="cancelTask(this)">Stop</button></div><div class="thinking-skeleton"><div class="thinking-skeleton-line"></div><div class="thinking-skeleton-line"></div><div class="thinking-skeleton-line"></div></div><div class="thinking-progress"><div class="thinking-progress-bar"></div></div><a href="/chat/threads" class="parallel-link" onclick="event.preventDefault();fetch(\'/chat/threads\',{method:\'POST\',redirect:\'follow\'}).then(function(r){if(r.redirected){window.open(r.url,\'_blank\')}else{return r.text().then(function(){window.open(\'/chat\',\'_blank\')})}});">Start another task in a new conversation &rarr;</a></div>';
    messages.appendChild(thinking);
    scrollToBottom();
    return thinking;
  }

  /**
   * Flush completed tasks from the front of the queue in order.
   * If task B finishes before task A, B's result is held until A completes.
   */
  function typewriterEffect(bubble, html, callback) {
    var temp = document.createElement("div");
    temp.innerHTML = html;
    var fullText = temp.textContent || "";
    var charIndex = 0;
    var speed = Math.max(5, Math.min(20, 2000 / fullText.length)); // adaptive speed

    // Show cursor
    var cursor = document.createElement("span");
    cursor.className = "typewriter-cursor";
    bubble.innerHTML = "";
    bubble.appendChild(cursor);

    function type() {
      if (charIndex < fullText.length) {
        // Add characters in chunks for longer texts
        var chunk = Math.ceil(fullText.length / 100);
        var end = Math.min(charIndex + chunk, fullText.length);
        bubble.innerHTML = renderMarkdown(fullText.slice(0, end));
        bubble.appendChild(cursor);
        charIndex = end;
        scrollToBottom();
        setTimeout(type, speed);
      } else {
        // Done — show full rendered HTML and remove cursor
        bubble.innerHTML = html;
        if (callback) callback();
        scrollToBottom();
      }
    }
    type();
  }

  function flushTaskQueue() {
    while (taskQueue.length > 0 && taskQueue[0].result !== null) {
      var entry = taskQueue.shift();
      entry.thinkingEl.remove();
      if (entry.result.error) {
        errorEl.textContent = entry.result.error;
      } else if (entry.result.content) {
        addMessageWithTypewriter("assistant", entry.result.content);
        fetchToolCalls(entry.taskId);
        maybeShowMemoryLink();
      }
    }
  }

  function fetchToolCalls(taskId) {
    fetch("/tasks/" + encodeURIComponent(taskId) + "/api")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.log || data.log.length === 0) return;
        var bubbles = messages.querySelectorAll(".chat-message.assistant .bubble");
        var lastBubble = bubbles[bubbles.length - 1];
        if (!lastBubble) return;

        var toolSection = document.createElement("details");
        toolSection.className = "tool-calls-section";
        var toolCount = data.log.length;
        toolSection.innerHTML = '<summary>Used ' + toolCount + ' tool' + (toolCount !== 1 ? 's' : '') + '</summary>'
          + '<div class="tool-calls-list">'
          + data.log.map(function(tc) {
            var isError = (tc.output || '').indexOf('"error"') !== -1;
            return '<div class="tool-call-item">'
              + '<span class="tool-name">' + escapeHtml(tc.tool) + '</span>'
              + '<span class="tool-duration">' + tc.duration_ms + 'ms</span>'
              + '<span class="tool-status ' + (isError ? 'tool-error' : 'tool-ok') + '">' + (isError ? 'error' : 'ok') + '</span>'
              + '</div>';
          }).join('')
          + '</div>';
        lastBubble.appendChild(toolSection);
      })
      .catch(function() {});
  }

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function addMessageWithTypewriter(role, content) {
    var emptyMsg = messages.querySelector(":scope > p");
    if (emptyMsg) emptyMsg.remove();

    var div = document.createElement("div");
    div.className = "chat-message " + role + " message-appear";

    var avatar = document.createElement("div");
    avatar.className = "avatar agent-avatar";
    avatar.title = agentName;
    var img = document.createElement("img");
    img.src = "/mascot.webp";
    img.alt = agentName;
    avatar.appendChild(img);

    var bubble = document.createElement("div");
    bubble.className = "bubble";

    div.appendChild(avatar);
    div.appendChild(bubble);
    messages.appendChild(div);
    scrollToBottom();

    var html = renderMarkdown(content);
    typewriterEffect(bubble, html, function() {
      // Re-enable input after typewriter finishes
      input.disabled = false;
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
      input.focus();
    });
  }

  /**
   * Poll for a specific task's status. Each task has its own poll loop.
   */
  function pollForTask(taskId, thinkingEl) {
    fetch("/chat/poll?taskId=" + encodeURIComponent(taskId))
      .then(function (res) {
        if (!res.ok) {
          if (res.status === 302 || res.redirected) {
            errorEl.textContent = "Session expired. Please refresh the page.";
            return Promise.reject("redirect");
          }
          return res.text().then(function (t) {
            return { tasks: [{ taskId: taskId, status: "error", error: t, done: true }] };
          });
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        var task = data.tasks && data.tasks[0];
        if (!task) {
          // Task disappeared — mark in queue and flush
          for (var i = 0; i < taskQueue.length; i++) {
            if (taskQueue[i].taskId === taskId) {
              taskQueue[i].result = { error: null, content: null };
              break;
            }
          }
          flushTaskQueue();
          return;
        }

        if (task.done) {
          // Store result in queue entry and flush in order
          for (var i = 0; i < taskQueue.length; i++) {
            if (taskQueue[i].taskId === taskId) {
              if (task.status === "error") {
                taskQueue[i].result = { error: task.error || "Something went wrong.", content: null };
              } else if (task.result) {
                taskQueue[i].result = { error: null, content: task.result.content };
              } else {
                taskQueue[i].result = { error: null, content: null };
              }
              break;
            }
          }
          flushTaskQueue();
          return;
        }

        // Update this specific thinking indicator's status text
        var thinkingText = thinkingEl.querySelector(".thinking-text");
        if (thinkingText && task.status && thinkingText.textContent !== task.status) {
          thinkingText.classList.add("fade-out");
          setTimeout(function () {
            thinkingText.textContent = task.status;
            thinkingText.classList.remove("fade-out");
          }, 300);
        }
        scrollToBottom();
        setTimeout(function () { pollForTask(taskId, thinkingEl); }, 1000);
      })
      .catch(function (err) {
        if (err === "redirect") return;
        setTimeout(function () { pollForTask(taskId, thinkingEl); }, 2000);
      });
  }

  // Re-render server-rendered assistant bubbles with markdown on load
  var existingBubbles = messages.querySelectorAll(".chat-message.assistant .bubble");
  for (var i = 0; i < existingBubbles.length; i++) {
    var raw = existingBubbles[i].textContent || "";
    existingBubbles[i].innerHTML = renderMarkdown(raw);
  }

  // --- Prompt history (arrow up/down to cycle) ---
  var HISTORY_KEY = "chatPromptHistory:" + (window.__chatConfig?.threadId || "global");
  var promptHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  var historyIndex = -1;
  var savedInput = "";

  function pushHistory(text) {
    if (!text.trim()) return;
    // Don't add duplicates at the end
    if (promptHistory.length > 0 && promptHistory[promptHistory.length - 1] === text) return;
    promptHistory.push(text);
    // Keep last 50
    if (promptHistory.length > 50) promptHistory = promptHistory.slice(-50);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(promptHistory));
    historyIndex = -1;
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp" && !e.shiftKey) {
      if (promptHistory.length === 0) return;
      e.preventDefault();
      if (historyIndex === -1) {
        savedInput = input.value;
        historyIndex = promptHistory.length - 1;
      } else if (historyIndex > 0) {
        historyIndex--;
      }
      input.value = promptHistory[historyIndex];
    } else if (e.key === "ArrowDown" && !e.shiftKey) {
      if (historyIndex === -1) return;
      e.preventDefault();
      if (historyIndex < promptHistory.length - 1) {
        historyIndex++;
        input.value = promptHistory[historyIndex];
      } else {
        historyIndex = -1;
        input.value = savedInput;
      }
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    // If recording, stop it — onstop will attach the file and re-trigger submit
    if (window.__isRecording && window.__stopRecording) {
      window.__submitAfterRecording = true;
      window.__stopRecording();
      return;
    }
    // If files are pending, let the upload handler in chat.ejs handle it
    if (window.__pendingFiles && window.__pendingFiles.length > 0) {
      window.__handleFileUpload();
      return;
    }
    var text = input.value.trim();
    if (!text) return;

    pushHistory(text);
    addMessage("user", text);
    input.value = "";
    errorEl.textContent = "";

    // Create thinking indicator (will be tagged with taskId after POST)
    var thinking = createThinkingIndicator("pending");

    // Submit message
    fetch("/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, threadId: window.__chatConfig?.threadId || "" }),
    })
      .then(function (res) {
        console.log("[post] status:", res.status, "redirected:", res.redirected);
        return res.json();
      })
      .then(function (data) {
        console.log("[post] response:", JSON.stringify(data));
        if (data.error) {
          thinking.remove();
          errorEl.textContent = data.error;
          return;
        }
        // If a new thread was auto-created, update the URL and sidebar
        if (data.threadId && (!window.__chatConfig?.threadId || window.__chatConfig.threadId !== data.threadId)) {
          window.__chatConfig = window.__chatConfig || {};
          window.__chatConfig.threadId = data.threadId;
          history.replaceState(null, "", "/chat?thread=" + data.threadId);
          // Refresh sidebar
          fetch("/chat/threads/api").then(function(r) { return r.json(); }).then(function(d) {
            var sidebar = document.getElementById("threadList");
            if (sidebar && d.threads) {
              sidebar.innerHTML = d.threads.map(function(t) {
                var tid = t.external_id.replace("chat:", "");
                var active = tid === data.threadId ? " active" : "";
                var date = new Date(t.updated_at + "Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return '<a href="/chat?thread=' + tid + '" class="thread-item' + active + '"><div class="thread-title">' + (t.title || t.preview?.slice(0, 40) || "New conversation") + '</div><div class="thread-meta">' + date + '</div></a>';
              }).join("");
            }
          }).catch(function() {});
        }
        // Tag the thinking indicator with the real task ID
        thinking.setAttribute("data-task-id", data.taskId);
        // Add to ordered queue
        taskQueue.push({ taskId: data.taskId, thinkingEl: thinking, result: null });
        // Start polling for this task
        pollForTask(data.taskId, thinking);
      })
      .catch(function (err) {
        thinking.remove();
        errorEl.textContent = err.message || "Connection error";
      });
  });

  // Cancel a running task
  window.cancelTask = function(btn) {
    var indicator = btn.closest(".thinking-indicator");
    var taskId = indicator ? indicator.getAttribute("data-task-id") : null;
    if (!taskId || taskId === "pending") return;
    btn.disabled = true;
    btn.textContent = "Stopping...";
    fetch("/chat/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: taskId }),
    }).then(function() {
      if (indicator) indicator.remove();
      addMessage("assistant", "Action cancelled.");
    }).catch(function() {
      btn.disabled = false;
      btn.textContent = "Stop";
    });
  };

  // Expose for audio recording and file upload integration
  window.addUserMessage = function(text) { addMessage("user", text); };
  window.addSystemMessage = function(text) {
    var div = document.createElement("div");
    div.className = "chat-system-message message-appear";
    div.style.cssText = "text-align:center;font-size:12px;color:var(--text-secondary);padding:8px 16px;font-style:italic;";
    div.textContent = text;
    messages.appendChild(div);
    scrollToBottom();
  };
  window.startPolling = function(taskId) {
    var thinking = createThinkingIndicator(taskId || "unknown");
    if (taskId) {
      taskQueue.push({ taskId: taskId, thinkingEl: thinking, result: null });
      pollForTask(taskId, thinking);
    }
  };

  scrollToBottom();

  // Check for in-flight tasks on page load (resume after navigation)
  fetch("/chat/pending")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.done) {
        console.log("[chat] Resuming in-flight task:", data.taskId);
        input.disabled = true;
        sendBtn.disabled = true;
        sendBtn.textContent = "...";
        var thinking = document.createElement("div");
        thinking.className = "chat-message assistant thinking-indicator";
        thinking.innerHTML = '<div class="avatar agent-avatar" title="' + agentName + '"><img src="/mascot.webp" alt="' + agentName + '" /></div><div class="bubble thinking-bubble"><span class="spinner"></span> <span class="thinking-text">' + (data.status || "Processing...") + '</span></div>';
        messages.appendChild(thinking);
        scrollToBottom();
        pollForResult();
      }
    })
    .catch(function() {});
})();
