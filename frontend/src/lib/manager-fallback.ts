/**
 * Offline & GitHub Pages manager fallback persona responses.
 * Provides warm, direct, encouraging responses adhering to SOUL.md
 * when the local backend server is not connected.
 */

export function getManagerFallbackResponse(prompt: string): string {
  const p = prompt.trim().toLowerCase();

  // "Plan my day" / schedule planning
  if (p.includes('plan') || p.includes('schedule') || p.includes('priority') || p.includes('today')) {
    return `### 📋 Today's Game Plan, Gardison

Good to see you locked in. Here is our battle plan:

1. **Morning Focus**: Knock out your clinical laboratory practicals/shift first. Do not let distractions or secondary tasks steal your early focus.
2. **Afternoon Sprint**: NestList marketplace feature work (rental listings & search flow).
3. **Evening Accountability**: Review completed tasks, update your streak, and plan tomorrow's 3 tasks.

> **Jarvis Strategy Tip**: *Pick Priority 1, set a 45-minute focus block, and get it off the board. Once you get that first win, the rest of the day builds on that momentum.*

---
*💡 Running in GitHub Pages static preview mode. To connect your live local Ollama model (qwen3.5:2b), enter your backend URL in **Settings ⚙️ > Connection**.*`;
  }

  // "I finished something" / celebratory check-in
  if (p.includes('finished') || p.includes('done') || p.includes('completed') || p.includes('knocked out')) {
    return `### 🔥 Outstanding Work!

That is how you build a real business and pass your exams at the same time—one focused block at a time.

- **Action**: Check off the priority in **Today's Top 3 Priorities** at the top of your screen to log your completion rate!
- **Current Streak**: Keeping your streak alive is how you beat procrastination permanently.

Take a 5-minute breather, hydrate, and tell me: **What is the next micro-task we are tackling?**

---
*💡 Running in GitHub Pages static preview mode. Connect your local Jarvis server at **Settings > Connection** to record check-ins to SQLite.*`;
  }

  // "Help me start" / procrastination pushback
  if (p.includes('start') || p.includes('procrastinat') || p.includes('stuck') || p.includes('lazy') || p.includes('tired')) {
    return `### 🛑 Let's Stop Overthinking This Right Now

Procrastination is not laziness—it is just the friction of starting. We are **not** doing the whole study block or building the whole NestList feature right now. 

We are doing **5 minutes**:
1. Open your code editor or study notes right now.
2. Pick the very first micro-action (write 1 function header or read 1 page of hematology).
3. Set a timer for 5 minutes. If you want to stop after 5 minutes, you can. (You won't want to).

**Go do step 1 right now. I will be right here waiting for you to report back.**

---
*💡 Running in GitHub Pages static preview mode. Connect your local Jarvis server at **Settings > Connection**.*`;
  }

  // Medical laboratory science or NestList questions
  if (p.includes('nestlist') || p.includes('property') || p.includes('rental') || p.includes('lab') || p.includes('hematology')) {
    return `### 🎯 Prioritize the Core Value

Whether you are debugging NestList rental marketplace features for Kenyan tenants or mastering laboratory diagnostics, remember the core principle: **keep it simple, test the critical path, and don't prematurely optimize.**

- For **NestList**: Focus on mobile responsiveness, fast search, and clean listing cards that load on slow 3G/4G connections.
- For **Lab Studies**: Focus on reference ranges, diagnostic markers, and hands-on bench protocol.

What specific problem are you working through right now?

---
*💡 Running in GitHub Pages static preview mode. Connect your local Jarvis server at **Settings > Connection** for deep reasoning via local Ollama models.*`;
  }

  // Default manager response
  return `### 👋 I'm With You, Gardison

I am your personal AI manager, built to keep you focused on building NestList and excelling in your medical laboratory studies while managing your shifts.

**How can I help you move the needle right now?**
- Click **"Plan my day"** to review your priorities and schedule.
- Click **"Help me start"** if you are feeling resistance or friction.
- Click **"I finished something"** to celebrate progress and update your streak.

---
*💡 Note: You are currently viewing OPUSJARVIS in GitHub Pages static preview mode. To enable full conversational AI with your local Ollama models and SQLite storage, enter your local server URL (e.g. \`http://localhost:8000\`) in **Settings ⚙️ > Connection**.*`;
}
