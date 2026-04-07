import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { Container, Service } from 'typedi';
import { EventBus as TsBus, createEventDefinition as tsCreateEventDefinition } from 'ts-bus';

// Internal global bus
const globalBus = new TsBus();

/**
 * EventBus isolates the application from the underlying `ts-bus` module.
 * It is used for publishing events and statically creating event definitions.
 */
@Service()
export class EventBus {
    /**
     * Statically creates an event definition without exposing ts-bus explicitly.
     */
    static createEvent<T = void>(eventName: string) {
        return tsCreateEventDefinition<T>()(eventName);
    }

    /**
     * Publishes an event to the global bus without awaiting handlers (fire-and-forget).
     */
    publish(event: any) {
        globalBus.publish(event);
    }

    /**
     * Publishes an event and awaits all async handlers to complete.
     * Handlers are executed concurrently via Promise.all under the hood.
     */
    async publishAndWait(event: any): Promise<any[]> {
        return await (globalBus as any).emitter.emitAsync(event.type, event);
    }
}

/**
 * System Lifecycle Events
 */
export const AppStartedEvent = EventBus.createEvent('APP_STARTED');
export const AppStoppingEvent = EventBus.createEvent('APP_STOPPING');

/**
 * Registry of all classes that contain the @Subscribe decorator.
 */
export const busSubscribers: any[] = [];

/**
 * Decorator to register an event handler on a class method.
 */
export function Subscribe(eventDefinition: any) {
    return function (target: any, propertyKey: string) {
        if (!busSubscribers.includes(target.constructor)) {
            busSubscribers.push(target.constructor);
        }

        const subscriptions = Reflect.getMetadata('bus:subscriptions', target.constructor) || [];
        subscriptions.push({ eventDefinition, propertyKey });
        Reflect.defineMetadata('bus:subscriptions', subscriptions, target.constructor);
    };
}

/**
 * Bootstraps the bus by auto-scanning the services directory to discover subscribers,
 * instantiating them, and linking their decorated methods to the global bus events.
 */
export function bootstrapBus() {
    const servicesPath = path.join(__dirname, '../handlers');
    if (fs.existsSync(servicesPath)) {
        const files = fs.readdirSync(servicesPath);
        for (const file of files) {
            if (file.endsWith('.ts') || file.endsWith('.js')) {
                require(path.join(servicesPath, file));
            }
        }
    }

    busSubscribers.forEach((handlerClass) => {
        const instance = Container.get(handlerClass) as any;
        const subscriptions = Reflect.getMetadata('bus:subscriptions', handlerClass) || [];

        subscriptions.forEach((sub: any) => {
            globalBus.subscribe(sub.eventDefinition, async (event: any) => {
                try {
                    await instance[sub.propertyKey](event.payload);
                } catch (error) {
                    console.error(`[EventBus] Error in subscriber '${handlerClass.name}.${sub.propertyKey}' for event '${sub.eventDefinition.eventType}':`, error);
                }
            });
        });
    });
}
