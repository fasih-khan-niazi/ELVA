import { Request, Response } from 'express';
import { TERMS_LAST_UPDATED, TERMS_VERSION } from '../constants/legal';

export const getLegalMeta = (req: Request, res: Response) => {
    res.json({
        termsVersion: TERMS_VERSION,
        termsLastUpdated: TERMS_LAST_UPDATED,
    });
};
