import { Router } from 'express';
import { getOrganizer, requireAdmin } from '../auth.js';
import {
  grantOrganizerByEmail,
  listOrganizersAndInvites,
  revokeOrganizerAccess,
} from '../roles-db.js';

export function adminRouter(): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/organizers', async (_req, res) => {
    try {
      const data = await listOrganizersAndInvites();
      res.json(data);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка списка' });
    }
  });

  router.post('/organizers/grant', async (req, res) => {
    try {
      const admin = getOrganizer(req);
      const email = (req.body as { email?: string }).email;
      if (!email?.trim()) {
        res.status(400).json({ error: 'Укажите email' });
        return;
      }
      const result = await grantOrganizerByEmail(admin.id, email);
      res.status(201).json({
        ...result,
        message:
          result.status === 'promoted'
            ? 'Пользователь уже был в системе — роль организатора выдана.'
            : 'Приглашение сохранено. После входа по этому email доступ откроется автоматически.',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'CANNOT_GRANT_ADMIN') {
        res.status(400).json({ error: 'Этот email — администратор платформы' });
        return;
      }
      console.error(e);
      res.status(500).json({ error: 'Не удалось выдать доступ' });
    }
  });

  router.post('/organizers/revoke', async (req, res) => {
    try {
      const email = (req.body as { email?: string }).email;
      if (!email?.trim()) {
        res.status(400).json({ error: 'Укажите email' });
        return;
      }
      await revokeOrganizerAccess(email);
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'CANNOT_REVOKE_ADMIN') {
        res.status(400).json({ error: 'Нельзя отозвать роль администратора' });
        return;
      }
      console.error(e);
      res.status(500).json({ error: 'Ошибка' });
    }
  });

  return router;
}
