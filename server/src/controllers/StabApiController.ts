import { Body, Get, JsonController, Post, UseBefore, Req, Res } from "routing-controllers";
import { Service } from "typedi";
import multer from 'multer';
import express from 'express';

@JsonController()
@Service()
export class StabApiController {

    @Get('/api/stab/api/v1/site/copyrights')
    async getCopyrights() {
        return {
            "status": "success",
            "data": {
                "copyright": "\n<p><span>\n    <noindex><span>© Copyright 2026, Apricot Digitals LLC<\/span><\/noindex>\n<\/span>\n<\/p>",
                "dnsmpi": ""
            },
            "meta": {
                "code": 200
            }
        };
    }

    @Post('/api/stab/user/register')
    @UseBefore(multer().none())
    @UseBefore(express.urlencoded({ extended: true }))
    async postUserRegister(@Body() body: any, @Req() req: any, @Res() res: any) {
        console.log('Form data received:', body);

        const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));

        if (isAjax || body?.ajax !== undefined) {
            return [];
        }

        let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Form Data</title></head><body>';
        html += '<h1>Submitted Form Data</h1>';
        html += '<table border="1" cellpadding="5" style="border-collapse: collapse;">';
        html += '<tr><th>Field</th><th>Value</th></tr>';

        const flatten = (obj: any, prefix = ''): Record<string, string> => {
            let result: Record<string, string> = {};
            for (const key in obj) {
                const newPrefix = prefix ? `${prefix}[${key}]` : key;
                if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                    result = { ...result, ...flatten(obj[key], newPrefix) };
                } else {
                    result[newPrefix] = String(obj[key]);
                }
            }
            return result;
        };

        const flatBody = flatten(body || {});

        for (const [key, value] of Object.entries(flatBody)) {
            html += `<tr><td><strong>${key}</strong></td><td><pre style="margin: 0;">${value}</pre></td></tr>`;
        }

        html += '</table></body></html>';

        res.setHeader('Content-Type', 'text/html');
        return res.send(html);
    }

    @Get('/api/stab/geo/suggestLocation')
    async getSuggestLocation() {
        return { "status": "success", "data": { "locations": ["Tesnyts\u2019ka", "Tesluhiv", "Tesiv", "Tesnivka", "Tesnivka", "Tesnivka", "Tesseli", "Tessy", "Tesnovka", "Ternivka", "Ternopil", "Tereshkivtsi", "Terentiyiv", "Ternovaya", "Anno-Ternovskaya", "T\u00ebploye", "Terpinnya", "Tets\u2019ke", "Tetevchytsi", "Feodosiya", "Tyahliv", "Tarasivka", "Tetiyiv", "Roskoshnoye", "Tel'manove", "Teplitsa", "Teklivka", "Teisarov", "Teofipol\u2019", "Fedorivka"] }, "meta": { "code": 200 } }
    }
}