import { Body, Get, JsonController, Post, UseBefore } from "routing-controllers";
import { Service } from "typedi";
import multer from 'multer';

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
    async postUserRegister(@Body() body: any) {
        console.log(body.UserForm);
        // if (body.scenario == 'ageOnly') {
        //     data = [];
        // }

        return [];
    }

    @Get('/api/stab/geo/suggestLocation')
    async getSuggestLocation() {
        return { "status": "success", "data": { "locations": ["Tesnyts\u2019ka", "Tesluhiv", "Tesiv", "Tesnivka", "Tesnivka", "Tesnivka", "Tesseli", "Tessy", "Tesnovka", "Ternivka", "Ternopil", "Tereshkivtsi", "Terentiyiv", "Ternovaya", "Anno-Ternovskaya", "T\u00ebploye", "Terpinnya", "Tets\u2019ke", "Tetevchytsi", "Feodosiya", "Tyahliv", "Tarasivka", "Tetiyiv", "Roskoshnoye", "Tel'manove", "Teplitsa", "Teklivka", "Teisarov", "Teofipol\u2019", "Fedorivka"] }, "meta": { "code": 200 } }
    }
}