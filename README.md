# OpsNexus AI: The COO Agent 🏭🤖

## 📖 Overview

OpsNexus AI is a comprehensive ERP (Enterprise Resource Planning) simulator designed for the Apparel Manufacturing sector. Unlike traditional, static dashboards, OpsNexus introduces a "Virtual COO" (Chief Operating Officer) powered by Google Gemini 3.0.

It ingests 6 months of operational data—ranging from fabric inventory and cutting floor metrics to financial P&L—and provides strategic, actionable insights. It features an innovative Text-to-SQL engine that allows non-technical users to query complex databases using natural language.

## 🚀 Key Features

### 🌟 Industry-First: Context-Aware Dynamic Navigation

> "The interface that thinks with you."

Most ERP systems suffer from "Button Clutter"—overwhelming users with hundreds of static menu options. We solved this with a novel Dynamic Morphing Navigation System that currently exists in no other mobile ERP.

* Adaptive Context: The bottom navigation bar isn't static. It detects the active module (e.g., *Manufacturing* vs. *Finance*) and morphs its buttons instantly.
* Predictive Actions: If you are in the "Cutting Floor" module, the primary action button automatically becomes "Log Cut Panels." If you switch to "Finance," it morphs into "Record Expense."
* Zero-Clutter UX: We reduced screen complexity by 60% by hiding irrelevant tools, surfacing only what the COO needs *right now*.

### 🧠 AI-Powered Analysis (Gemini Integration)
* Strategic Health Check: The AI analyzes comprehensive datasets (Sales, Production, Finance) to generate a "COO Executive Briefing," identifying risks in cash flow and supply chain.
* Natural Language SQL Lab: Users can ask questions like *"Show me the top 5 selling items"* and Gemini translates this into valid SQL to query the in-browser database.
* Automated Process Mining: Detects bottlenecks in the production line (e.g., delays between Cutting and Sewing) and suggests optimization strategies.
* Smart Demand Forecasting: Predicts future inventory needs based on historical sales trends.

### 🏭 Core ERP Modules
* Manufacturing Loop: Simulation of Cutting, Sewing, Packing, and Finishing processes.
* Inventory & SCM: Real-time tracking of Raw Materials (Fabric/Accessories) and Finished Goods.
* Financials: Automated Profit & Loss (P&L) and Balance Sheet generation.
* BI Dashboard: Interactive Charts using Chart.js for real-time visualization.

## 🛠️ How We Built It

This project utilizes a Serverless, Offline-First architecture to demonstrate privacy and speed, leveraging WebAssembly (WASM) for database operations.

### Tech Stack
* AI Model: Google Gemini 3.0 (Pro/Flash) via REST API.
* Frontend: Vanilla JavaScript (ES6+), CSS3 (Modern Flexbox/Grid).
* Database: SQL.js (SQLite over WebAssembly) for robust, client-side relational data handling.
* Visualization: Chart.js for BI analytics.
* Reporting: jsPDF and html2canvas for generating PDF reports.

### Gemini Implementation Details
We implemented a callGemini module that acts as the bridge between the ERP state and the AI.
1.  Context Injection: The system serializes relevant operational snapshots (JSON) and feeds them into Gemini's long-context window.
2.  Prompt Engineering: We designed specific system instructions for "Analyst Persona" and "SQL Translator Persona" to ensure accurate outputs
