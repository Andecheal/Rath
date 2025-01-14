import { makeAutoObservable, runInAction } from 'mobx';
import { TextWriter, ZipReader } from "@zip.js/zip.js";
import { IAccessPageKeys } from '../interfaces';
import { getMainServiceAddress } from '../utils/user';
import { notify } from '../components/error';
import { request } from '../utils/request';
import { IKRFComponents, IParseMapItem } from '../utils/download';
import { commitLoginService } from './fetch';
import { getGlobalStore } from '.';

export interface ILoginForm {
    userName: string;
    password: string;
    email: string;
}

export interface INotebook {
    readonly id: number;
    readonly name: string;
    readonly size: number;
    readonly createAt: number;
    readonly downLoadURL: string;
}

export interface IWorkspace {
    readonly id: number;
    readonly name: string;
    notebooks?: readonly INotebook[] | null | undefined;
}

export interface IOrganization {
    readonly name: string;
    readonly id: number;
    workspaces?: readonly IWorkspace[] | null | undefined;
}

interface ISignUpForm {
    userName: string;
    password: string;
    checkPassword: string;
    email: string;
    phone: string;
    certCode: string;
    invCode: string;
}

interface IUserInfo {
    userName: string;
    email: string;
    eduEmail: string;
    phone: string;
    avatarURL: string;
    organizations?: readonly IOrganization[] | undefined;
}

export default class UserStore {
    public login!: ILoginForm;
    public signup!: ISignUpForm;
    public info: IUserInfo | null = null;
    public get loggedIn() {
        return this.info !== null;
    }
    public get userName() {
        return this.info?.userName ?? null;
    }
    constructor() {
        this.init()
        makeAutoObservable(this);
    }
    public init() {
        this.login = {
            userName: '',
            password: '',
            email: '',
        };
        this.signup = {
            userName: '',
            password: '',
            checkPassword: '',
            email: '',
            phone: '',
            certCode: '',
            invCode: '',
        }
        this.info = null;
    }
    public destroy () {
        this.info = null;
    }

    public updateForm(formKey: IAccessPageKeys, fieldKey: keyof ILoginForm | keyof ISignUpForm, value: string) {
        if (fieldKey in this[formKey]) {
            // @ts-ignore
            this[formKey][fieldKey] = value;
        }
    }

    public async liteAuth(certMethod: 'email' | 'phone') {
        const url = getMainServiceAddress('/api/liteAuth');
        const { certCode, phone, email } = this.signup;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                certCode,
                certMethod,
                certAddress: certMethod === 'email' ? email : phone,
            }),
        });
        const result = await res.json() as (
            | { success: true; data: boolean }
            | { success: false; message: string }
        );
        if (result.success) {
            notify({
                type: 'success',
                content: 'Login succeeded',
                title: 'Success',
            });
            return result.data;
        } else {
            notify({
                type: 'error',
                content: `${result.message}`,
                title: 'Error',
            });
            throw new Error(`${result.message}`);
        }
    }

    public async commitLogin() {
        try {
            const res = await commitLoginService(this.login);
            return res;
        } catch (error) {
            notify({
                title: 'Login error',
                type: 'error',
                content: `[/api/login] ${error}`,
            });
        }
    }

    public async commitLogout() {
        try {
            const url = getMainServiceAddress('/api/logout');
            const res = await fetch(url, {
                method: 'GET',
            });
            if (res) {
                runInAction(() => {
                    this.info = null;
                });
                notify({
                    title: 'Logout',
                    type: 'success',
                    content: 'Logout success!',
                });
            }
        } catch (error) {
            notify({
                title: 'logout error',
                type: 'error',
                content: `[/api/logout] ${error}`,
            });
        }
    }

    public async updateAuthStatus() {
        try {
            const url = getMainServiceAddress('/api/loginStatus');
            const res = await request.get<{}, { loginStatus: boolean; userName: string }>(url);
            return res.loginStatus;
        } catch (error) {
            notify({
                title: '[/api/loginStatus]',
                type: 'error',
                content: `${error}`,
            });
            return false;
        }
    }

    public async getPersonalInfo() {
        const url = getMainServiceAddress('/api/ce/personal');
        try {
            const result = await request.get<{}, IUserInfo>(url);
            if (result !== null) {
                runInAction(() => {
                    this.info = {
                        userName: result.userName,
                        eduEmail: result.eduEmail,
                        email: result.email,
                        phone: result.phone,
                        avatarURL: result.avatarURL,
                    };
                    this.getOrganizations();
                });
            }
        } catch (error) {
            notify({
                title: '[/api/ce/personal]',
                type: 'error',
                content: `${error}`,
            });
        }
    }

    protected async getOrganizations() {
        const url = getMainServiceAddress('/api/ce/organization/list');
        try {
            const result = await request.get<{}, { organization: readonly IOrganization[] }>(url);
            runInAction(() => {
                this.info!.organizations = result.organization;
            });
        } catch (error) {
            notify({
                title: '[/api/ce/organization/list]',
                type: 'error',
                content: `${error}`,
            });
        }
    }

    public async getWorkspaces(organizationId: number) {
        const which = this.info?.organizations?.find(org => org.id === organizationId);
        if (!which || which.workspaces !== undefined) {
            return null;
        }
        const url = getMainServiceAddress('/api/ce/organization/workspace/list');
        try {
            const result = await request.get<{ organizationId: number }, { workspaceList: Exclude<IWorkspace, 'notebooks'>[] }>(url, {
                organizationId,
            });
            runInAction(() => {
                which.workspaces = result.workspaceList;
            });
            return result.workspaceList;
        } catch (error) {
            notify({
                title: '[/api/ce/organization/workspace/list]',
                type: 'error',
                content: `${error}`,
            });
            return null;
        }
    }

    public async getNotebooks(organizationId: number, workspaceId: number, forceUpdate = false) {
        const which = this.info?.organizations?.find(org => org.id === organizationId)?.workspaces?.find(wsp => wsp.id === workspaceId);
        if (!which) {
            return null;
        }
        if (!forceUpdate && which.notebooks !== undefined) {
            return null;
        }
        const url = getMainServiceAddress('/api/ce/notebook/list');
        try {
            const result = await request.get<{ organizationId: number }, { notebookList: INotebook[] }>(url, {
                organizationId,
            });
            runInAction(() => {
                which.notebooks = result.notebookList;
            });
            return result.notebookList;
        } catch (error) {
            notify({
                title: '[/api/ce/notebook/list]',
                type: 'error',
                content: `${error}`,
            });
            return null;
        }
    }

    public async uploadNotebook(workspaceId: number, file: File) {
        const url = getMainServiceAddress('/api/ce/notebook');
        try {
            const { uploadUrl, id } = (await (await fetch(url, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: file.name,
                    type: 0,    // TODO: customize type of upload workspace
                    workspaceId,
                    fileType: file.type,
                    introduction: '',
                    size: file.size,
                }),
            })).json()).data;
            await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
            });
            await request.post<{ id: number }, {}>(getMainServiceAddress('/api/ce/notebook/callback'), { id });
        } catch (error) {
            notify({
                title: '[/api/ce/notebook]',
                type: 'error',
                content: `${error}`,
            });
        }
    }

    public async openNotebook(downLoadURL: string) {
        try {
            const data = await fetch(downLoadURL, { method: 'GET' });
            if (!data.ok) {
                throw new Error(data.statusText);
            }
            if (!data.body) {
                throw new Error('Request got empty body');
            }
            await this.loadNotebook(data.body);
        } catch (error) {
            notify({
                title: '[download notebook]',
                type: 'error',
                content: `${error}`,
            });
        }
    }

    public async loadNotebook(body: ReadableStream<Uint8Array> | File) {
        try {
            const zipReader = new ZipReader(body instanceof File ? body.stream() : body);
            const result = await zipReader.getEntries();
            const manifestFile = result.find((entry) => {
                return entry.filename === "parse_map.json";
            });
            if (!manifestFile) {
                throw new Error('Cannot find parse_map.json')
            }
            const writer = new TextWriter();
            const manifest = JSON.parse(await manifestFile.getData(writer)) as {
                items: IParseMapItem[];
                version: string;
            };
            const { dataSourceStore, causalStore, dashboardStore, collectionStore } = getGlobalStore();
            for await (const { name, key } of manifest.items) {
                const entry = result.find(which => which.filename === name);
                if (!entry || key === IKRFComponents.meta) {
                    continue;
                }
                const w = new TextWriter();
                try {
                    const res = await entry.getData(w);
                    switch (key) {
                        case IKRFComponents.data: {
                            const metaFile = manifest.items.find(item => item.type === IKRFComponents.meta);
                            if (!metaFile) {
                                break;
                            }
                            const meta = result.find(which => which.filename === metaFile.name);
                            if (!meta) {
                                break;
                            }
                            const wm = new TextWriter();
                            const rm = await meta.getData(wm);
                            await dataSourceStore.loadBackupDataStore(JSON.parse(res), JSON.parse(rm));
                            break;
                        }
                        case IKRFComponents.collection: {
                            collectionStore.loadBackup(JSON.parse(res));
                            break;
                        }
                        case IKRFComponents.causal: {
                            causalStore.load(JSON.parse(res));
                            break;
                        }
                        case IKRFComponents.dashboard: {
                            dashboardStore.loadAll(JSON.parse(res));
                            break;
                        }
                        default: {
                            break;
                        }
                    }
                } catch (error) {
                    notify({
                        title: 'Load Notebook Error',
                        type: 'error',
                        content: `${error}`,
                    });
                    continue;
                }
            }
        } catch (error) {
            notify({
                title: 'Load Notebook Error',
                type: 'error',
                content: `${error}`,
            });
        }
    }

}
