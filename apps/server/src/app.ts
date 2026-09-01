import express from "express";
import cors from "cors";
import path from "path";
import router from "./routes/index.js";
import Logger from "./controllers/Logger.js";

const app = express();

app.use(cors({
    origin: true, // Reflect the request origin
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use((req, res, next) => {
    Logger.getInstance().info(`${req.method} ${req.url}`);
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file serving is handled in server.ts


// API Routes
app.use("/api", (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
}, router);

// Health check
app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

export default app;
