// Group scoped environment variables.
//
// The middle layer between the instance-wide globals and a pipeline's own
// file. See ConfigController.getGroupEnvPath for why it exists.
//
// Permissions ride on the GROUP, not on 'global-env': somebody trusted with
// FileFreak's credentials is not thereby trusted with notch.fm's, and a single
// permission covering both would make this scoping cosmetic.

import { Router, Request, Response } from 'express';
import { ConfigController } from '../controllers/ConfigController.js';
import Logger from '../controllers/Logger.js';
import { PermissionsService } from '../services/PermissionsService.js';

const router = Router();
const configController = ConfigController.getInstance();
const logger = Logger.getInstance();
const permissions = PermissionsService.getInstance();

const allowed = (req: Request, res: Response, group: string, action: 'view' | 'editEnv'): boolean => {
    const user = (req as any).user;
    if (!group) {
        res.status(400).json({ error: 'A group is required' });
        return false;
    }
    // Write needs write on the group; read needs read. Falls back to the
    // instance-wide global-env permission, so an existing admin is not locked
    // out of a feature that did not exist when their permissions were set.
    const ok = action === 'editEnv'
        ? permissions.checkAccess(user.id, group, 'write') || permissions.checkPermission(user.id, 'global-env', 'editEnv')
        : permissions.checkAccess(user.id, group, 'read') || permissions.checkPermission(user.id, 'global-env', 'view');
    if (!ok) {
        res.status(403).json({ error: `Access denied to ${group}'s environment` });
        return false;
    }
    return true;
};

router.get('/:group/keys', (req: Request, res: Response) => {
    try {
        const { group } = req.params;
        if (!allowed(req, res, group, 'view')) return;
        res.json({ keys: configController.getGroupEnvKeys(group) });
    } catch (e) {
        logger.error('Failed to list group env keys', e);
        res.status(400).json({ error: (e as Error).message });
    }
});

router.get('/:group/keys-with-values', (req: Request, res: Response) => {
    try {
        const { group } = req.params;
        if (!allowed(req, res, group, 'editEnv')) return;
        res.json({ variables: configController.getGroupEnvWithValues(group) });
    } catch (e) {
        logger.error('Failed to read group env', e);
        res.status(400).json({ error: (e as Error).message });
    }
});

router.post('/:group/set', (req: Request, res: Response) => {
    try {
        const { group } = req.params;
        if (!allowed(req, res, group, 'editEnv')) return;
        const { key, value } = req.body ?? {};
        if (!key || typeof key !== 'string') {
            res.status(400).json({ error: 'key is required' });
            return;
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            res.status(400).json({ error: 'key must be letters, digits and underscores, not starting with a digit' });
            return;
        }
        configController.setGroupEnvVariable(group, key, String(value ?? ''));
        res.json({ success: true, message: `Set ${key} for ${group}` });
    } catch (e) {
        logger.error('Failed to set group env variable', e);
        res.status(400).json({ error: (e as Error).message });
    }
});

router.delete('/:group/:key', (req: Request, res: Response) => {
    try {
        const { group, key } = req.params;
        if (!allowed(req, res, group, 'editEnv')) return;
        configController.deleteGroupEnvVariable(group, key);
        res.json({ success: true, message: `Deleted ${key} from ${group}` });
    } catch (e) {
        logger.error('Failed to delete group env variable', e);
        res.status(400).json({ error: (e as Error).message });
    }
});

export default router;
