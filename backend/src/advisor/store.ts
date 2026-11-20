import { DataTypes, Model, Op, type Sequelize } from "sequelize";
import type { PlannedSection } from "../planning.js";

export interface AdvisorSchedule {
  id: string;
  name: string;
  term: string;
  college: string;
  sections: PlannedSection[];
  interests: string[];
  committed: boolean;
}

type ScheduleRow = AdvisorSchedule & { owner: string; createdAt: Date };

export function createAdvisorStore(database: Sequelize) {
  const profiles = database.define<Model<{ owner: string; interests: string[] }>>("AdvisorProfile", {
    owner: { type: DataTypes.STRING(64), primaryKey: true },
    interests: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: false },
  }, { tableName: "advisor_profiles", timestamps: false });
  const schedules = database.define<Model<ScheduleRow>>("AdvisorSchedule", {
    id: { type: DataTypes.UUID, primaryKey: true },
    owner: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    term: { type: DataTypes.STRING(4), allowNull: false },
    college: { type: DataTypes.STRING(12), allowNull: false },
    sections: { type: DataTypes.JSONB, allowNull: false },
    interests: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: false },
    committed: { type: DataTypes.BOOLEAN, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  }, {
    tableName: "advisor_schedules",
    timestamps: false,
    indexes: [
      { fields: ["owner", "term"], unique: true, where: { committed: true } },
      { fields: ["term", "college"], where: { committed: true } },
    ],
  });
  let schema: Promise<unknown> | undefined;

  function ready() {
    schema ??= profiles.sync().then(() => schedules.sync()).catch((error: unknown) => {
      schema = undefined;
      throw error;
    });
    return schema;
  }

  function present(row: Model<ScheduleRow>): AdvisorSchedule {
    const { id, name, term, college, sections, interests, committed } = row.get();
    return { id, name, term, college, sections, interests, committed };
  }

  async function list(owner: string) {
    await ready();
    return (await schedules.findAll({ where: { owner }, order: [["createdAt", "DESC"], ["id", "ASC"]] })).map(present);
  }

  async function setInterests(owner: string, interests: string[]) {
    await ready();
    await profiles.upsert({ owner, interests });
  }

  async function getInterests(owner: string) {
    await ready();
    return (await profiles.findByPk(owner))?.getDataValue("interests");
  }

  async function save(owner: string, schedule: AdvisorSchedule) {
    await ready();
    const [row] = await schedules.findOrCreate({
      where: { id: schedule.id, owner },
      defaults: { ...schedule, owner, createdAt: new Date() },
    });
    return present(row);
  }

  async function find(owner: string, id: string) {
    await ready();
    const row = await schedules.findOne({ where: { owner, id } });
    return row ? present(row) : null;
  }

  async function setCommitment(owner: string, id: string, committed: boolean) {
    await ready();
    return database.transaction(async (transaction) => {
      // Serialize changes to a student's commitments, including simultaneous tabs.
      if (!await profiles.findByPk(owner, { transaction, lock: transaction.LOCK.UPDATE })) return null;
      const schedule = await schedules.findOne({ where: { owner, id }, transaction });
      if (!schedule) return null;

      if (committed) {
        await schedules.update({ committed: false }, {
          where: { owner, term: schedule.getDataValue("term"), committed: true, id: { [Op.ne]: id } },
          transaction,
        });
      }
      await schedule.update({ committed }, { transaction });
      return present(schedule);
    });
  }

  async function matchingClasses(owner: string, term: string, college: string) {
    const interests = await getInterests(owner);
    if (!interests?.length) return [];
    const matches = await schedules.findAll({
      attributes: ["sections"],
      where: { term, college, committed: true, owner: { [Op.ne]: owner }, interests: { [Op.overlap]: interests } },
    });
    return [...new Set(matches.flatMap((match) => match.getDataValue("sections").map(({ section }) => section.classNumber)))];
  }

  return { list, save, find, setInterests, getInterests, setCommitment, matchingClasses };
}
