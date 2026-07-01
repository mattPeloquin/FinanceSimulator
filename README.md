# 📈 Personal Finance Simulator

Welcome to the Sequence-of-Returns Finance Simulator! This is a powerful, interactive tool that helps you visualize your financial future, plan for retirement, and understand the risks associated with the stock market. 

We built this project with two main goals: **keep it incredibly easy to use** and **keep it incredibly easy to deploy**.

## 🚀 Why is this so easy to deploy?

Unlike modern web applications that require complex databases and web servers, this entire simulator is engineered to bundle into a **single, self-contained HTML file**.

- **No Servers Needed:** You don't need a database or backend server to run this.
- **Run Anywhere:** Once built, you can literally double-click the final `index.html` file and it will run perfectly in your browser.
- **Host for Free:** You can drag and drop your built file onto free hosting platforms (like GitHub Pages, Netlify, or Vercel) and have your own live website in seconds.

---

## 🛠️ Setting Up Your Dev Environment

You don't need to be a software engineer to modify this app! You just need a few basic tools installed on your computer.

### Step 1: Install the basics
1. **Node.js**: Download and install the LTS version from [nodejs.org](https://nodejs.org/). This runs the background tools needed to build the project.
2. **Cursor**: Download and install [Cursor](https://cursor.sh/), an AI-powered code editor that will essentially write the code for you.

### Step 2: Get the project running
1. Open the **Cursor** app.
2. Go to `File > Open Folder` and select the folder containing this project.
3. Open the Terminal inside Cursor by clicking `Terminal > New Terminal` in the top menu (or pressing `` Ctrl + ` ``).
4. In the terminal window, type:
   ```bash
   npm install
   ```
   *Press Enter. This downloads the necessary project files (it may take a minute).*
5. Once that finishes, type:
   ```bash
   npm run dev
   ```
   *Press Enter. This starts up your local preview. You'll see a web link (usually `http://localhost:5173`). Click it or copy it into your browser (or Ctrl-Click the link in the terminal) to see the app running live!*

---

## ✨ Extending the Code by "Vibe Coding"

You do not need to know how to code to add new features to this app. Instead, you can use **Vibe Coding**—where you use natural language to tell an AI what you want, and the AI handles the complex syntax and logic.

### How to Vibe Code with Cursor
Cursor has a built-in AI assistant. You essentially act as the "Product Manager," and Cursor acts as your "Programmer."

1. **Use the Composer (Ctrl+I / Cmd+I)**
   - Press `Ctrl + I` (or `Cmd + I` on Mac) to open the AI Composer.
   - Simply type what you want to achieve in plain English.
   - *Example:* "Make the background of the app dark mode," or "Add a new text input for 'Annual Inflation Rate' next to the starting balance."
   - The AI will generate the code across multiple files. Simply click **Accept All** to apply it.

2. **Use the Chat Panel (Ctrl+L / Cmd+L)**
   - If you want to ask questions or figure out how something works, open the Chat panel.
   - *Example:* "How do the charts in this project work? I want to change the line color from red to blue."
   - The AI will read your files and give you the exact steps or code snippets you need.

3. **Handling Errors? Just ask the AI!**
   - If you add a feature and the screen goes blank, don't panic! 
   - Just copy whatever error you see in the terminal or on the screen, paste it into the Cursor chat, and say: "I got this error, please fix it." The AI will figure out what went wrong and fix it.

4. **Trust the Tests**
   - This project has automated tests to make sure things don't break. If you add a new feature, you can tell Cursor: "I just added an inflation input. Run the tests and fix any issues caused by my changes."

### Building Your Final Version
Once you've vibe-coded your app to perfection and want to share it with the world, open the terminal and type:
```bash
npm run build
```
This will bundle your entire app into a single `index.html` file located in the `dist` folder. You can now send that file to anyone or drag-and-drop it onto a web host! Happy building!