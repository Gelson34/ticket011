import { delay, WAMessage, AnyMessageContent } from "@whiskeysockets/baileys";
import * as Sentry from "@sentry/node";
import fs from "fs";
import { exec } from "child_process";
import path from "path";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Ticket from "../../models/Ticket";
import mime from "mime-types";
import { request } from "express";
interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  companyId?: number;
  body?: string;
}
const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");
const processAudio = async (
  audio: string,
  companyId: string
): Promise<string> => {
  console.log("USERXX", companyId, "RE", request);
  const outputAudio = `${publicFolder}/company${companyId}/${new Date().getTime()}.mp3`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath.path} -i ${audio} -vn -ab 128k -ar 44100 -f ipod ${outputAudio} -y`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        if (fs.existsSync(outputAudio) && fs.existsSync(audio)) {
          fs.unlinkSync(audio);
          fs.renameSync(outputAudio, audio);
        }
        resolve(audio);
      }
    );
  });
};
const processAudioFile = async (
  audio: string,
  companyId: string
): Promise<string> => {
  console.log("USERXXY", request);
  const outputAudio = `${publicFolder}/company${companyId}/${new Date().getTime()}.mp3`;
  return new Promise((resolve, reject) => {
    exec(
      `${
        ffmpegPath.path
      } -i ${audio} -vn -ar 44100 -ac 2 -b:a 192k ${outputAudio.replace(
        "companyundefined",
        `company${companyId}`
      )} -y`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        fs.unlinkSync(audio);
        resolve(outputAudio);
      }
    );
  });
};
export const getMessageOptions = async (
  fileName: string,
  pathMedia: string,
  companyId?: string
): Promise<any> => {
  const mimeType = mime.lookup(pathMedia);
  const typeMessage = mimeType.split("/")[0];
  try {
    if (!mimeType) {
      throw new Error("Invalid mimetype");
    }
    let options: AnyMessageContent;
    if (typeMessage === "video") {
      options = {
        video: fs.readFileSync(pathMedia),
        fileName: fileName,
        mimetype: "video/mp4"
      };
    } else if (typeMessage === "audio") {
      const typeAudio = fileName.includes("audio-record-site");
      const convert = await processAudio(pathMedia, companyId);
      if (typeAudio) {
        options = {
          audio: fs.readFileSync(convert),
          mimetype: typeAudio ? "audio/mp4" : mimeType,
          ptt: true
        };
      } else {
        options = {
          audio: fs.readFileSync(convert),
          mimetype: typeAudio ? "audio/mp4" : mimeType,
          ptt: true
        };
      }
    } else if (typeMessage === "document") {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: fileName,
        fileName: fileName,
        mimetype: mimeType
      };
    } else if (typeMessage === "application") {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: fileName,
        fileName: fileName,
        mimetype: mimeType
      };
    } else {
      options = { image: fs.readFileSync(pathMedia) };
    }
    return options;
  } catch (e) {
    Sentry.captureException(e);
    console.log(e);
    return null;
  }
};
const SendWhatsAppMedia = async ({
  media,
  ticket,
  body,
}: Request): Promise<WAMessage> => {
  try {
    const wbot = await GetTicketWbot(ticket);
    const companyId = ticket.companyId.toString();
    console.log("AAAAAAAAAAAA", companyId);
    const pathMedia = media.path;
    const typeMessage = media.mimetype.split("/")[0];
    let options: AnyMessageContent;
    if (typeMessage === "video") {
      options = {
        video: fs.readFileSync(pathMedia),
        caption: body,
        fileName: media.originalname.replace("/", "-")
      };
    } else if (typeMessage === "audio") {
      const typeAudio = media.originalname.includes("audio-record-site");
      if (typeAudio) {
        const convert = await processAudio(media.path, companyId);
        options = {
          audio: fs.readFileSync(convert),
          mimetype: typeAudio ? "audio/mp4" : media.mimetype,
          ptt: true
        };
      } else {
        const convert = await processAudioFile(media.path, companyId);
        options = {
          audio: fs.readFileSync(convert),
          mimetype: typeAudio ? "audio/mp4" : media.mimetype
        };
      }
    } else if (typeMessage === "document" || typeMessage === "text") {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: body,
        fileName: media.originalname.replace("/", "-"),
        mimetype: media.mimetype
      };
    } else if (typeMessage === "application") {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: body,
        fileName: media.originalname.replace("/", "-"),
        mimetype: media.mimetype
      };
    } else {
      options = { image: fs.readFileSync(pathMedia), caption: body };
    }

    const sentMessage = await wbot.sendMessage(
      `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      { ...options }
    );
    await ticket.update({ lastMessage: media.filename });
    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};
export default SendWhatsAppMedia;
