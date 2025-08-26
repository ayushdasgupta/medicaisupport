import express from 'express';
import 'dotenv/config'
import cors from 'cors'
import cookieParser from 'cookie-parser';
import { agentBuilder } from './ai-models/agent.js';
import { isAuthPatient } from './middlware/isAuthPatient.js';
import { connectDB } from './db/config.js';
connectDB()
const app = express()
const PORT = process.env.PORT 
app.use(cookieParser());
app.use(express.json())
app.use(cors({
  origin: process.env.FRONTEND_URL,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,

}))
app.get("/",(req, res) => {
    res.json({
        success: true,
        message: "Hello From AI API server"
    })
})

app.post("/ai-chats",isAuthPatient, async (req, res) => {
    const { input } = req.body

    const wholemessage=`${input}. My name is ${req.patient.name}.If necceary My patient id is ${req.patient._id}.Dont output anything about patient id.`
    const messages = [{
        role: "user",
        content: wholemessage
    }];
    const aiMsg = await agentBuilder.invoke({
        messages
    });

    // const lastObject = aiMsg.messages[aiMsg.messages.length - 1].kwargs;
    // const content = lastObject.content;
    res.json({
        success:true,
        message:aiMsg.messages[aiMsg.messages.length-1].lc_kwargs["content"]
    })
});

app.listen(PORT, () => {
    console.log(`AI Api server is running on http://localhost:${PORT}`);
})

