import * as Sentry from "@sentry/node";
import Queue from "bull";
import { MessageData, SendMessage } from "./helpers/SendMessage";
import Whatsapp from "./models/Whatsapp";
import { logger } from "./utils/logger";
import moment from "moment";
import Schedule from "./models/Schedule";
import Tag from "./models/Tag";
import Contact from "./models/Contact";
import { Op, QueryTypes } from "sequelize";
import GetDefaultWhatsApp from "./helpers/GetDefaultWhatsApp";
import Campaign from "./models/Campaign";
import ContactList from "./models/ContactList";
import ContactListItem from "./models/ContactListItem";
import { isEmpty, isNil, isArray } from "lodash";
import CampaignSetting from "./models/CampaignSetting";
import CampaignShipping from "./models/CampaignShipping";
import GetWhatsappWbot from "./helpers/GetWhatsappWbot";
import sequelize from "./database";
import { getMessageOptions } from "./services/WbotServices/SendWhatsAppMedia";
import { getIO } from "./libs/socket";
import path from "path";
import User from "./models/User";
import Plan from "./models/Plan";
import Company from "./models/Company";
import ListWhatsAppsService from "./services/WhatsappService/ListWhatsAppsService";
import { ClosedAllOpenTickets } from "./services/WbotServices/wbotClosedTickets";
import { TicketTaskMoveToQueue } from "./services/TicketServices/TicketTaskMoveToQueue";
import { executaAcaoACada10Segundos } from "./services/cronjob/cronJob";

// Execute o cronjob
executaAcaoACada10Segundos();
const nodemailer = require("nodemailer");
const CronJob = require("cron").CronJob;
const connection = process.env.REDIS_URI || "";
const limiterMax = process.env.REDIS_OPT_LIMITER_MAX || 1;
const limiterDuration = process.env.REDIS_OPT_LIMITER_DURATION || 3000;
interface ProcessCampaignData {
  id: number;
  delay: number;
}
interface PrepareContactData {
  contactId: number;
  campaignId: number;
  delay: number;
  variables: any[];
}
interface DispatchCampaignData {
  campaignId: number;
  campaignShippingId: number;
  contactListItemId: number;
}
export const userMonitor = new Queue("UserMonitor", connection);
export const messageQueue = new Queue("MessageQueue", connection, {
  limiter: { max: limiterMax as number, duration: limiterDuration as number }
});
export const scheduleMonitor = new Queue("ScheduleMonitor", connection);
export const sendScheduledMessages = new Queue(
  "SendSacheduledMessages",
  connection
);
export const campaignQueue = new Queue("CampaignQueue", connection);
async function handleSendMessage(job) {
  try {
    const { data } = job;
    const whatsapp = await Whatsapp.findByPk(data.whatsappId);
    if (whatsapp == null) {
      throw Error("Whatsapp não identificado");
    }
    const messageData: MessageData = data.data;
    await SendMessage(whatsapp, messageData);
  } catch (e: any) {
    Sentry.captureException(e);
    logger.error("MessageQueue -> SendMessage: error", e.message);
    throw e;
  }
}
async function handleVerifySchedules(job) {
  logger.info(`Verificacao de novas mensagem de disparo agendado`);
  try {
    const { count, rows: schedules } = await Schedule.findAndCountAll({
      where: {
        status: "PENDENTE",
        sentAt: null,
        sendAt: {
          [Op.gte]: moment().format("YYYY-MM-DD HH:mm:ss"),
          [Op.lte]: moment().add("30", "seconds").format("YYYY-MM-DD HH:mm:ss")
        }
      },
      include: [{ model: Contact, as: "contact" }]
    });
    if (count > 0) {
      schedules.map(async schedule => {
        await schedule.update({ status: "AGENDADA" });
        sendScheduledMessages.add(
          "SendMessage",
          { schedule },
          { delay: 40000 }
        );
        logger.info(`Disparo agendado para: ${schedule.contact.name}`);
      });
    }
  } catch (e: any) {
    Sentry.captureException(e);
    logger.error("SendScheduledMessage -> Verify: error", e.message);
    throw e;
  }
}

async function handleSendScheduledMessage(job) {
  const {
    data: { schedule }
  } = job;
  let scheduleRecord: Schedule | null = null;

  try {
    scheduleRecord = await Schedule.findByPk(schedule.id);

    // Verificar se daysR existe e é um valor numérico
    if (scheduleRecord?.daysR !== null) {
      
        let existingSendAt = moment(scheduleRecord.sendAt);
        
        const companyId = schedule.companyId;
        const whatsapp = await GetDefaultWhatsApp(schedule.companyId);
        let filePath = null;
    
        
       
        const tagId = scheduleRecord?.campId;
        let modBody;
        let modPath;
        let modName;
        let newSendAt;
        if (tagId) {
          Tag.findByPk(tagId)
          .then(async (tag) => {
              if (tag) {
                newSendAt = existingSendAt
                .add(tag.rptDays, "days") // Use daysR para adicionar os dias desejados
                .format("YYYY-MM-DD HH:mm");
                modName = tag.mediaName;
                // Faça algo com a tag encontrada
                
                if (tag.mediaPath) {
                  await SendMessage(whatsapp, {
                    number: schedule.contact.number,
                    body: tag.msgR,
                    companyId: schedule.companyId
                    
                  });
                  filePath = path.resolve(`public/company${companyId}`, tag.mediaPath);
                  await SendMessage(whatsapp, {
                    number: schedule.contact.number,
                    body: tag.msgR,
                    mediaPath: filePath, //adicionado
                    companyId: schedule.companyId
                    
                  });
                } 
                if (tag.rptDays === 0){
                  await scheduleRecord?.update({
                    sentAt: moment().format("YYYY-MM-DD HH:mm"),
                    status: "ENVIADA"
                  });
                } else{
                  await scheduleRecord?.update({
                    sendAt: newSendAt,
                    status: "PENDENTE"
                  });
                }
                
        
                // Log apenas, não atualiza o status
                logger.info(
                  `Mensagem agendada enviada para: ${schedule.contact.name} `
                );
              } else {
                console.log('Tag não encontrada');
              }
            })
            .catch((error) => {
              console.error('Erro ao buscar tag:', error);
            });
        } else {
          console.log('ID da tag não está definido em scheduleRecord');
        }
        

        
      
    } else {
      // Código para daysR não existe ou não é um valor numérico
      // Prossiga para o agendamento normalmente e atualize o status
      const companyId = schedule.companyId;
      const whatsapp = await GetDefaultWhatsApp(schedule.companyId);
      let filePath = null;
      
      await SendMessage(whatsapp, {
        number: schedule.contact.number,
        body: schedule.body,
        companyId: schedule.companyId
      });

      if (schedule.mediaPath) {
        filePath = path.resolve(`public/company${companyId}`, schedule.mediaPath);
        await SendMessage(whatsapp, {
          number: schedule.contact.number,
          body: schedule.body,
          mediaPath: filePath, //adicionado
          companyId: schedule.companyId
          
        });
      } 

      await scheduleRecord?.update({
        sentAt: moment().format("YYYY-MM-DD HH:mm"),
        status: "ENVIADA"
      });

      // Log para indicar que o agendamento foi concluído
      logger.info(
        `Mensagem agendada enviada para: ${schedule.contact.name} `
      );

      // Limpeza da fila
      sendScheduledMessages.clean(15000, "completed");
    }
  } catch (e: any) {
    Sentry.captureException(e);
    // Se ocorrer um erro, atualize o status para "ERRO" e registre o erro, mas não interrompa a execução
    await scheduleRecord?.update({ status: "ERRO" });
    logger.error("SendScheduledMessage -> SendMessage: error", e.message);
  }
}

async function handleVerifyCampaigns(job) {
  const campaigns: { id: number; scheduledAt: string }[] =
    await sequelize.query(
      `select id, "scheduledAt" from "Campaigns" c
    where "scheduledAt" between now() and now() + '1 hour'::interval and status = 'PROGRAMADA'`,
      { type: QueryTypes.SELECT }
    );
  logger.info(`Campanhas encontradas: ${campaigns.length}`);
  for (let campaign of campaigns) {
    try {
      const now = moment();
      const scheduledAt = moment(campaign.scheduledAt);
      const delay = scheduledAt.diff(now, "milliseconds");
      logger.info(
        `Campanha enviada para a fila de processamento: Campanha=${campaign.id}, Delay Inicial=${delay}`
      );
      campaignQueue.add(
        "ProcessCampaign",
        { id: campaign.id, delay },
        { removeOnComplete: true }
      );
    } catch (err: any) {
      Sentry.captureException(err);
    }
  }
}
async function getCampaign(id) {
  return await Campaign.findByPk(id, {
    include: [
      {
        model: ContactList,
        as: "contactList",
        attributes: ["id", "name"],
        include: [
          {
            model: ContactListItem,
            as: "contacts",
            attributes: ["id", "name", "number", "email", "isWhatsappValid"],
            where: { isWhatsappValid: true }
          }
        ]
      },
      { model: Whatsapp, as: "whatsapp", attributes: ["id", "name"] },
      {
        model: CampaignShipping,
        as: "shipping",
        include: [{ model: ContactListItem, as: "contact" }]
      }
    ]
  });
}
async function getContact(id) {
  return await ContactListItem.findByPk(id, {
    attributes: ["id", "name", "number", "email"]
  });
}
async function getSettings(campaign) {
  const settings = await CampaignSetting.findAll({
    where: { companyId: campaign.companyId },
    attributes: ["key", "value"]
  });
  let messageInterval: number = 20;
  let longerIntervalAfter: number = 20;
  let greaterInterval: number = 60;
  let variables: any[] = [];
  settings.forEach(setting => {
    if (setting.key === "messageInterval") {
      messageInterval = JSON.parse(setting.value);
    }
    if (setting.key === "longerIntervalAfter") {
      longerIntervalAfter = JSON.parse(setting.value);
    }
    if (setting.key === "greaterInterval") {
      greaterInterval = JSON.parse(setting.value);
    }
    if (setting.key === "variables") {
      variables = JSON.parse(setting.value);
    }
  });
  return { messageInterval, longerIntervalAfter, greaterInterval, variables };
}
export function parseToMilliseconds(seconds) {
  return seconds * 1000;
}
async function sleep(seconds) {
  logger.info(
    `Sleep de ${seconds} segundos iniciado: ${moment().format("HH:mm:ss")}`
  );
  return new Promise(resolve => {
    setTimeout(() => {
      logger.info(
        `Sleep de ${seconds} segundos finalizado: ${moment().format(
          "HH:mm:ss"
        )}`
      );
      resolve(true);
    }, parseToMilliseconds(seconds));
  });
}
function getCampaignValidMessages(campaign) {
  const messages = [];
  if (!isEmpty(campaign.message1) && !isNil(campaign.message1)) {
    messages.push(campaign.message1);
  }
  if (!isEmpty(campaign.message2) && !isNil(campaign.message2)) {
    messages.push(campaign.message2);
  }
  if (!isEmpty(campaign.message3) && !isNil(campaign.message3)) {
    messages.push(campaign.message3);
  }
  if (!isEmpty(campaign.message4) && !isNil(campaign.message4)) {
    messages.push(campaign.message4);
  }
  if (!isEmpty(campaign.message5) && !isNil(campaign.message5)) {
    messages.push(campaign.message5);
  }
  return messages;
}
function getCampaignValidConfirmationMessages(campaign) {
  const messages = [];
  if (
    !isEmpty(campaign.confirmationMessage1) &&
    !isNil(campaign.confirmationMessage1)
  ) {
    messages.push(campaign.confirmationMessage1);
  }
  if (
    !isEmpty(campaign.confirmationMessage2) &&
    !isNil(campaign.confirmationMessage2)
  ) {
    messages.push(campaign.confirmationMessage2);
  }
  if (
    !isEmpty(campaign.confirmationMessage3) &&
    !isNil(campaign.confirmationMessage3)
  ) {
    messages.push(campaign.confirmationMessage3);
  }
  if (
    !isEmpty(campaign.confirmationMessage4) &&
    !isNil(campaign.confirmationMessage4)
  ) {
    messages.push(campaign.confirmationMessage4);
  }
  if (
    !isEmpty(campaign.confirmationMessage5) &&
    !isNil(campaign.confirmationMessage5)
  ) {
    messages.push(campaign.confirmationMessage5);
  }
  return messages;
}
function getProcessedMessage(msg: string, variables: any[], contact: any) {
  let finalMessage = msg;
  if (finalMessage.includes("{nome}")) {
    finalMessage = finalMessage.replace(/{nome}/g, contact.name);
  }
  if (finalMessage.includes("{email}")) {
    finalMessage = finalMessage.replace(/{email}/g, contact.email);
  }
  if (finalMessage.includes("{numero}")) {
    finalMessage = finalMessage.replace(/{numero}/g, contact.number);
  }
  variables.forEach(variable => {
    if (finalMessage.includes(`{${variable.key}}`)) {
      const regex = new RegExp(`{${variable.key}}`, "g");
      finalMessage = finalMessage.replace(regex, variable.value);
    }
  });
  return finalMessage;
}
export function randomValue(min, max) {
  return Math.floor(Math.random() * max) + min;
}
async function verifyAndFinalizeCampaign(campaign) {
  const { contacts } = campaign.contactList;
  const count1 = contacts.length;
  const count2 = await CampaignShipping.count({
    where: { campaignId: campaign.id, deliveredAt: { [Op.not]: null } }
  });
  if (count1 === count2) {
    await campaign.update({ status: "FINALIZADA", completedAt: moment() });
  }
  const io = getIO();
  io.emit(`company-${campaign.companyId}-campaign`, {
    action: "update",
    record: campaign
  });
}
async function handleProcessCampaign(job) {
  try {
    const { id }: ProcessCampaignData = job.data;
    let { delay }: ProcessCampaignData = job.data;
    const campaign = await getCampaign(id);
    const settings = await getSettings(campaign);
    if (campaign) {
      const { contacts } = campaign.contactList;
      if (isArray(contacts)) {
        let index = 0;
        for (let contact of contacts) {
          campaignQueue.add(
            "PrepareContact",
            {
              contactId: contact.id,
              campaignId: campaign.id,
              variables: settings.variables,
              delay: delay || 0
            },
            { removeOnComplete: true }
          );
          logger.info(
            `Registro enviado pra fila de disparo: Campanha=${campaign.id};Contato=${contact.name};delay=${delay}`
          );
          index++;
          if (index % settings.longerIntervalAfter === 0) {
            delay += parseToMilliseconds(settings.greaterInterval);
          } else {
            delay += parseToMilliseconds(
              randomValue(0, settings.messageInterval)
            );
          }
        }
        await campaign.update({ status: "EM_ANDAMENTO" });
      }
    }
  } catch (err: any) {
    Sentry.captureException(err);
  }
}
async function handlePrepareContact(job) {
  try {
    const { contactId, campaignId, delay, variables }: PrepareContactData =
      job.data;
    const campaign = await getCampaign(campaignId);
    const contact = await getContact(contactId);
    const campaignShipping: any = {};
    campaignShipping.number = contact.number;
    campaignShipping.contactId = contactId;
    campaignShipping.campaignId = campaignId;
    const messages = getCampaignValidMessages(campaign);
    if (messages.length) {
      const radomIndex = randomValue(0, messages.length);
      const message = getProcessedMessage(
        messages[radomIndex],
        variables,
        contact
      );
      campaignShipping.message = `\u200c${message}`;
    }
    if (campaign.confirmation) {
      const confirmationMessages =
        getCampaignValidConfirmationMessages(campaign);
      if (confirmationMessages.length) {
        const radomIndex = randomValue(0, confirmationMessages.length);
        const message = getProcessedMessage(
          confirmationMessages[radomIndex],
          variables,
          contact
        );
        campaignShipping.confirmationMessage = `\u200c${message}`;
      }
    }
    const [record, created] = await CampaignShipping.findOrCreate({
      where: {
        campaignId: campaignShipping.campaignId,
        contactId: campaignShipping.contactId
      },
      defaults: campaignShipping
    });
    if (
      !created &&
      record.deliveredAt === null &&
      record.confirmationRequestedAt === null
    ) {
      record.set(campaignShipping);
      await record.save();
    }
    if (
      record.deliveredAt === null &&
      record.confirmationRequestedAt === null
    ) {
      const nextJob = await campaignQueue.add(
        "DispatchCampaign",
        {
          campaignId: campaign.id,
          campaignShippingId: record.id,
          contactListItemId: contactId
        },
        { delay }
      );
      await record.update({ jobId: nextJob.id });
    }
    await verifyAndFinalizeCampaign(campaign);
  } catch (err: any) {
    Sentry.captureException(err);
    logger.error(`campaignQueue -> PrepareContact -> error: ${err.message}`);
  }
}
async function handleDispatchCampaign(job) {
  try {
    const { data } = job;
    const { campaignShippingId, campaignId }: DispatchCampaignData = data;
    const campaign = await getCampaign(campaignId);
    const wbot = await GetWhatsappWbot(campaign.whatsapp);
    logger.info(
      `Disparo de campanha solicitado: Campanha=${campaignId};Registro=${campaignShippingId}`
    );
    const campaignShipping = await CampaignShipping.findByPk(
      campaignShippingId,
      { include: [{ model: ContactListItem, as: "contact" }] }
    );
    const chatId = `${campaignShipping.number}@s.whatsapp.net`;
    if (campaign.confirmation && campaignShipping.confirmation === null) {
      await wbot.sendMessage(chatId, {
        text: campaignShipping.confirmationMessage
      });
      await campaignShipping.update({ confirmationRequestedAt: moment() });
    } else {
      await wbot.sendMessage(chatId, { text: campaignShipping.message });
      if (campaign.mediaPath) {
        const companyId = campaign.companyId;
        const filePath = path.resolve(
          `public/company${companyId}`,
          campaign.mediaPath
        );
        const options = await getMessageOptions(campaign.mediaName, filePath);
        if (Object.keys(options).length) {
          await wbot.sendMessage(chatId, { ...options });
        }
      }
      await campaignShipping.update({ deliveredAt: moment() });
    }
    await verifyAndFinalizeCampaign(campaign);
    const io = getIO();
    io.emit(`company-${campaign.companyId}-campaign`, {
      action: "update",
      record: campaign
    });
    logger.info(
      `Campanha enviada para: Campanha=${campaignId};Contato=${campaignShipping.contact.name}`
    );
  } catch (err: any) {
    Sentry.captureException(err);
    logger.error(err.message);
    console.log(err.stack);
  }
}
async function handleLoginStatus(job) {
  const users: { id: number }[] = await sequelize.query(
    `select id from "Users" where "updatedAt" < now() - '5 minutes'::interval and online = true`,
    { type: QueryTypes.SELECT }
  );
  for (let item of users) {
    try {
      const user = await User.findByPk(item.id);
      await user.update({ online: false });
      logger.info(`Usuário passado para offline: ${item.id}`);
    } catch (e: any) {
      Sentry.captureException(e);
    }
  }
}
async function handleInvoiceCreate() {
  const job = new CronJob("0 * * * * *", async () => {
    const companies = await Company.findAll();
    companies.map(async c => {
      var dueDate = c.dueDate;
      const date = moment(dueDate).format();
      const timestamp = moment().format();
      const hoje = moment(moment()).format("DD/MM/yyyy");
      var vencimento = moment(dueDate).format("DD/MM/yyyy");
      var diff = moment(vencimento, "DD/MM/yyyy").diff(
        moment(hoje, "DD/MM/yyyy")
      );
      var dias = moment.duration(diff).asDays();
      if (dias < 30) {
        const plan = await Plan.findByPk(c.planId);
        const sql = `SELECT COUNT(*) mycount FROM "Invoices" WHERE "companyId" = ${
          c.id
        } AND "dueDate"::text LIKE '${moment(dueDate).format("yyyy-MM-DD")}%';`;
        const invoice = await sequelize.query(sql, { type: QueryTypes.SELECT });
        if (invoice[0]["mycount"] > 0) {
        } else {
          const valuePlan = plan.amount.replace(",", ".");
          const sql = `INSERT INTO "Invoices" (detail, status, value, "updatedAt", "createdAt", "dueDate", "companyId", "users", "connections", "queues", "useWhatsapp", "useFacebook", "useInstagram", "useCampaigns", "useSchedules", "useInternalChat", "useExternalApi")
          VALUES ('${plan.name}', 'open', ${valuePlan}, '${timestamp}', '${timestamp}', '${date}', ${c.id}, ${plan.users}, ${plan.connections}, ${plan.queues}, ${plan.useWhatsapp}, ${plan.useFacebook}, ${plan.useInstagram}, ${plan.useCampaigns}, ${plan.useSchedules}, ${plan.useInternalChat}, ${plan.useExternalApi});`;
          const invoiceInsert = await sequelize.query(sql, {
            type: QueryTypes.INSERT
          });
        }
      }
    });
  });
  job.start();
}
async function handleCloseTicketsAutomatic() {
  const job = new CronJob("5 * * * * *", async () => {
    const companies = await Company.findAll();
    companies.map(async c => {
      try {
        const companyId = c.id;
        await ClosedAllOpenTickets(companyId);
        logger.info(`Fechando tickets em abertos da companyId: ${companyId}`);
      } catch (e: any) {
        Sentry.captureException(e);
        logger.error("SendScheduledMessage -> Verify: error", e.message);
        throw e;
      }
    });
  });
  job.start();
}
//MOVER TICKET PARA FILA AUTOMATICAMENTE
/*const handleSendMessagesToQueue = async () => {
  const job = new CronJob('0 * * * * *', async () => {
    await TicketTaskMoveToQueue();
  });
  job.start();
};

handleSendMessagesToQueue();*/
handleCloseTicketsAutomatic();
handleInvoiceCreate();
export async function startQueueProcess() {
  logger.info("Iniciando processamento de filas");
  messageQueue.process("SendMessage", handleSendMessage);
  scheduleMonitor.process("Verify", handleVerifySchedules);
  sendScheduledMessages.process("SendMessage", handleSendScheduledMessage);
  campaignQueue.process("VerifyCampaigns", handleVerifyCampaigns);
  campaignQueue.process("ProcessCampaign", handleProcessCampaign);
  campaignQueue.process("PrepareContact", handlePrepareContact);
  campaignQueue.process("DispatchCampaign", handleDispatchCampaign);
  userMonitor.process("VerifyLoginStatus", handleLoginStatus);
  scheduleMonitor.add(
    "Verify",
    {},
    { repeat: { cron: "*/5 * * * * *" }, removeOnComplete: true }
  );
  campaignQueue.add(
    "VerifyCampaigns",
    {},
    { repeat: { cron: "*/20 * * * * *" }, removeOnComplete: true }
  );
  userMonitor.add(
    "VerifyLoginStatus",
    {},
    { repeat: { cron: "* * * * *" }, removeOnComplete: true }
  );
}
