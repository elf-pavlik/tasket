# -*- coding: utf-8 -*-
import json

from django.test import TestCase
from django.core.urlresolvers import reverse
from django.core.files.base import ContentFile
from django.conf import settings

from django.contrib.auth.models import User
from django.conf import settings

from tasks.models import Hub, Task, Profile
import tasks


class WorkflowTests(TestCase):
    fixtures = ['test_data.json',]

    def setUp(self):
        self.U1 = Profile.objects.get(pk=2)
        self.U2 = Profile.objects.get(pk=3)
        self.U3 = Profile.objects.get(pk=4)

    def test_verify_task(self):
        """
        An owner of a task verifies it's really done.
        """

        self.client.login(username=self.U1.user.username, password='12345')
        response = self.client.put(
                '/tasks/3',
                data=json.dumps({
                    "state" : Task.STATE_VERIFIED,
                    "claimedBy" : 2,
                    }),
                content_type='application/json',
            )
        json_data = json.loads(response.content)
        self.assertEqual(json_data['state'], Task.STATE_VERIFIED)
    
    def test_verify_task_not_owner(self):
        """
        A non-admin, non-owner attempts to verify a task.
        
        This should fail
        """
        
        self.client.login(username=self.U2.user.username, password='12345')
        response = self.client.put(
                '/tasks/5',
                data=json.dumps({
                        "state" : Task.STATE_VERIFIED,
                        "verifiedBy" : 3
                    }),
                content_type='application/json',
            )
        json_data = json.loads(response.content)
        self.assertTrue('error' in json_data)
    
    
    def test_claim_new(self):
        for u in [self.U1, self.U2, self.U3,]:
            self.client.login(username=u.user.username, password='12345')
            response = self.client.put(
                    '/tasks/6',
                    data=json.dumps({"state" : Task.STATE_CLAIMED}),
                    content_type='application/json',
                )
            json_data = json.loads(response.content)
            self.assertEqual(json_data['state'], Task.STATE_CLAIMED)
            self.assertEqual(json_data['claimedBy'], str(u.pk))

            response = self.client.put(
                    '/tasks/6',
                    data=json.dumps({"state" : Task.STATE_NEW}),
                    content_type='application/json',
                )
            json_data = json.loads(response.content)
            self.assertEqual(json_data['state'], Task.STATE_NEW)
            self.assertEqual(json_data['claimedBy'], '')

    def test_claim_already(self):
        self.client.login(username=self.U3.user.username, password='12345')
        response = self.client.put(
                '/tasks/5',
                data=json.dumps({"state" : Task.STATE_CLAIMED}),
                content_type='application/json',
            )
        json_data = json.loads(response.content)
        self.assertEqual(response.status_code, 500)

    def test_edit_claimed(self):
        self.client.login(username=self.U3.user.username, password='12345')
        response = self.client.put(
            '/tasks/5',
            json.dumps({
                'description' : 'Updated',
            }),
            content_type='application/json'
        )
        json_data = json.loads(response.content)
        self.assertTrue(json_data['description'].startswith('Updated'))
        
    def test_verify_new(self):
        self.client.login(username=self.U3.user.username, password='12345')
        response = self.client.put(
                '/tasks/6',
                data=json.dumps({"state" : Task.STATE_DONE}),
                content_type='application/json',
            )
        json_data = json.loads(response.content)
        self.assertTrue('claimedBy' in json_data)
        self.assertEqual(response.status_code, 500)
        
    def test_authorization_header(self):
        response = self.client.get('/')
        self.assertTrue(response.has_header('Authorization'))
    
    def test_reset_to_new(self):
        self.client.login(username=self.U1.user.username, password='12345')
        response = self.client.put(
                '/tasks/6',
                data=json.dumps({"state" : Task.STATE_CLAIMED}),
                content_type='application/json',
            )
        response = self.client.put(
                '/tasks/6',
                data=json.dumps({"state" : Task.STATE_NEW}),
                content_type='application/json',
            )
    
    def test_claim_then_done(self):
        self.client.login(username=self.U1.user.username, password='12345')
        response = self.client.put(
                '/tasks/6',
                data=json.dumps({"state" : Task.STATE_CLAIMED}),
                content_type='application/json',
            )
        self.assertNotEquals(json.loads(response.content)['claimedBy'], None)
        response = self.client.put(
                '/tasks/6',
                data=json.dumps({"state" : Task.STATE_DONE}),
                content_type='application/json',
            )

        self.assertTrue('doneTime' in json.loads(response.content))
        

    def test_claim_then_done_someone_else(self):
        self.client.login(username=self.U1.user.username, password='12345')
        response = self.client.put(
                '/tasks/6',
                data=json.dumps({"state" : Task.STATE_CLAIMED}),
                content_type='application/json',
            )
        self.client.login(username=self.U2.user.username, password='12345')
        response = self.client.put(
                '/tasks/6',
                data=json.dumps({"state" : Task.STATE_CLAIMED}),
                content_type='application/json',
            )
        self.assertTrue('error' in json.loads(response.content))
        self.assertFalse('doneTime' in json.loads(response.content))

    def test_too_many_tasks(self):
        self.client.login(username='TestUser', password='12345')
        hub = Hub.objects.get(pk=2)
        for i in range(getattr(settings, 'TASK_LIMIT', 11)):
            response = self.client.post(
                '/tasks/',
                json.dumps({
                    "description" : "Lorem ipsum dolor sit amet, consectetur",
                    "estimate" : 60*10,
                    "hub" : hub.pk,
                }),
                content_type='application/json',
                )
        json_data = json.loads(response.content)
        self.assertTrue('error' in json_data)
        self.assertEqual(json_data['error'], ['Too many Tasks already'])

    
    def test_claim_too_many(self):
        """
        Gready user that claims too much!
        """
        self.client.login(username='TestUser', password='12345')
        
        # Make some dummy tasks
        hub = Hub.objects.get(pk=2)
        for i in range(6):
            response = self.client.post(
                '/tasks/',
                json.dumps({
                    "description" : "Lorem ipsum dolor sit amet, consectetur",
                    "estimate" : 60*10,
                    "hub" : hub.pk,
                }),
                content_type='application/json',
                )
        
        for t in Task.objects.filter(claimedBy=None):
            response = self.client.put(
                    '/tasks/%s' % t.pk,
                    data=json.dumps({"state" : Task.STATE_CLAIMED}),
                    content_type='application/json',
                )
        json_data = json.loads(response.content)
        self.assertTrue('error' in json_data)
        self.assertEquals(json_data['error'], ["You can only claim 5 tasks at once"])
        
        # Make sure the user can still create a task, even though they are
        # up to their claimed limit.
        response = self.client.post(
            '/tasks/',
            json.dumps({
                "description" : "Lorem ipsum dolor sit amet, consectetur",
                "estimate" : 60*10,
                "hub" : hub.pk,
            }),
            content_type='application/json',
            )
        json_data = json.loads(response.content)
        self.assertTrue('state' in json_data)
        

    def test_maximum_times(self):
        self.client.login(username='TestUser', password='12345')
        hub = Hub.objects.get(pk=2)
        
        maximum_time = settings.TASK_ESTIMATE_MAX
        
        response = self.client.post(
            '/tasks/',
            json.dumps({
                "description" : "Lorem ipsum dolor sit amet, consectetur",
                "estimate" : maximum_time-10,
                "hub" : hub.pk,
            }),
            content_type='application/json',
            )

        json_data = json.loads(response.content)
        self.assertEqual(json_data['estimate'], maximum_time-10)


        response = self.client.post(
            '/tasks/',
            json.dumps({
                "description" : "Lorem ipsum dolor sit amet, consectetur",
                "estimate" : maximum_time+10,
                "hub" : hub.pk,
            }),
            content_type='application/json',
            )

        json_data = json.loads(response.content)
        self.assertTrue(json_data['estimate'][0].startswith("Estimate is too high"))
    

    def test_task_save_verified_string(self):
        self.client.login(username='TestUser', password='12345')
        response = self.client.put('/tasks/5', 
            json.dumps(
                    {"description":"This has been claimed, but not done.",
                    "image":"images/ACH_4307_3.jpg",
                    "estimate":600,
                    "state":"claimed",
                    "id":"5",
                    "createdTime":1298625303,
                    "hub":"3",
                    "doneTime":"",
                    "owner":"2",
                    "verifiedTime":"",
                    "claimedTime":1298625903,
                    "verifiedBy":"",
                    "claimedBy":"2",
                    }
                ),
                content_type='application/json',
                )
        json_data = json.loads(response.content)
        self.assertEqual(json_data['claimedTime'], 1298625903)

    def make_tasks(self, n):
        """
        Makes some tasks
        """
        hub = Hub.objects.get(pk=2)
        for i in range(n):
            response = self.client.post(
                '/tasks/',
                json.dumps({
                    "description" : "Lorem ipsum dolor sit amet, consectetur",
                    "estimate" : 60*10,
                    "hub" : hub.pk,
                }),
                content_type='application/json',
                )

    def test_edit_at_task_limit(self):
        """
        See https://github.com/premasagar/tasket/issues/162
        """
        self.client.login(username='TestUser', password='12345')
        self.make_tasks(settings.TASK_LIMIT + 2)
        response =  self.client.put('/tasks/12', json.dumps({'description' : 'Updated'}),content_type='application/json',)
        json_data = json.loads(response.content)
        self.assertTrue(json_data['description'].startswith('Updated'))
        
    def test_claimed_in_profile(self):
        """
        See https://github.com/premasagar/tasket/issues/150
        """
        self.client.login(username='TestUser', password='12345')
        response =  self.client.put('/tasks/6', json.dumps({'state' : Task.STATE_CLAIMED}), content_type='application/json',)
        response =  self.client.get('/users/2')
        json_data = json.loads(response.content)
        self.assertTrue('6' in json_data['tasks']['claimed']['claimed'])
        self.assertEqual(json_data['estimates']['claimed']['claimed'], 1800)
        
        
        
        
        